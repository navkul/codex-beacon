import AppKit
import Foundation

enum SummaryState: String, Decodable {
    case ready
    case done
    case blocked
    case failed
    case needsInput = "needs-input"
}

struct CommandSpec: Decodable {
    let executable: String
    let args: [String]
}

struct UsageWindowSnapshot: Decodable {
    let usedPercent: Double
    let windowMinutes: Double?
    let resetsAt: Double?
    let resetsInSeconds: Double?
}

struct SessionUsageSnapshot: Decodable {
    let primary: UsageWindowSnapshot?
    let secondary: UsageWindowSnapshot?
    let totalTokens: Double?
    let lastTurnTokens: Double?
    let planType: String?
    let capturedAt: String?
}

struct OverlayPresentation: Decodable {
    let width: Double
    let maxVisibleRows: Int
    let summaryVisible: Bool
    let summaryMaxLines: Int
}

struct OverlayEvent: Decodable {
    let type: String
    let sessionId: String
    let displayName: String?
    let summary: String?
    let state: SummaryState?
    let usage: SessionUsageSnapshot?
    let timestamp: String?
    let focusCommand: CommandSpec?
    let repromptCommand: CommandSpec?
    let presentation: OverlayPresentation?
}

struct OverlayItem {
    let sessionId: String
    let displayName: String
    let summary: String
    let state: SummaryState
    let usage: SessionUsageSnapshot?
    let timestamp: String
    let focusCommand: CommandSpec
    let repromptCommand: CommandSpec?
}

struct OverlaySnapshot: Decodable {
    let presentation: OverlayPresentation?
    let items: [OverlayEvent]
}

struct OverlayStateFile: Codable {
    var orderedSessionIds: [String]
}

final class OverlayLogger {
    static let shared = OverlayLogger()

    private let url: URL?
    private let queue = DispatchQueue(label: "codex-beacon.overlay.log")
    private let formatter = ISO8601DateFormatter()

    private init() {
        if let explicit = ProcessInfo.processInfo.environment["CODEX_BEACON_OVERLAY_LOG_PATH"], !explicit.isEmpty {
            self.url = URL(fileURLWithPath: explicit)
        } else {
            self.url = nil
        }
    }

    func log(_ message: String) {
        guard let url else {
            return
        }

        let line = "\(formatter.string(from: Date())) pid=\(ProcessInfo.processInfo.processIdentifier) \(message)\n"
        guard let data = line.data(using: .utf8) else {
            return
        }

        queue.async {
            let directory = url.deletingLastPathComponent()
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: url.path) {
                FileManager.default.createFile(atPath: url.path, contents: nil)
            }

            guard let handle = try? FileHandle(forWritingTo: url) else {
                return
            }
            defer {
                try? handle.close()
            }

            handle.seekToEndOfFile()
            handle.write(data)
        }
    }
}

final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

final class OverlayStateStore {
    private let url: URL
    private var orderedSessionIds: [String]

    init(url: URL) {
        self.url = url
        self.orderedSessionIds = Self.load(url: url).orderedSessionIds
    }

    func orderedIds() -> [String] {
        orderedSessionIds
    }

    func insertIfNeeded(sessionId: String) {
        guard !orderedSessionIds.contains(sessionId) else {
            return
        }
        orderedSessionIds.insert(sessionId, at: 0)
        save()
    }

    func remove(sessionId: String) {
        orderedSessionIds.removeAll { $0 == sessionId }
        save()
    }

    func replace(with sessionIds: [String]) {
        orderedSessionIds = sessionIds
        save()
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let file = OverlayStateFile(orderedSessionIds: orderedSessionIds)
        if let data = try? encoder.encode(file) {
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: url, options: .atomic)
        }
    }

    private static func load(url: URL) -> OverlayStateFile {
        guard
            let data = try? Data(contentsOf: url),
            let state = try? JSONDecoder().decode(OverlayStateFile.self, from: data)
        else {
            return OverlayStateFile(orderedSessionIds: [])
        }
        return state
    }
}

final class UsageMeterView: NSView {
    private let usage: SessionUsageSnapshot

    init(usage: SessionUsageSnapshot) {
        self.usage = usage
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        toolTip = usageTooltip(usage)
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: 56),
            heightAnchor.constraint(equalToConstant: 18)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var isFlipped: Bool {
        true
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        guard let context = NSGraphicsContext.current?.cgContext else {
            return
        }

        let primaryPercent = clamp(usage.primary?.usedPercent ?? 0)
        let secondaryPercent = clamp(usage.secondary?.usedPercent ?? 0)
        let primaryTrackRect = CGRect(x: 0, y: 1, width: 38, height: 10)
        let batteryTipRect = CGRect(x: 40, y: 3.5, width: 3, height: 5)
        let weeklyTrackRect = CGRect(x: 0, y: 14, width: 43, height: 2)

        context.setFillColor(NSColor.white.withAlphaComponent(0.08).cgColor)
        context.addPath(NSBezierPath(roundedRect: primaryTrackRect, xRadius: 5, yRadius: 5).cgPath)
        context.fillPath()
        context.setStrokeColor(NSColor.white.withAlphaComponent(0.12).cgColor)
        context.setLineWidth(1)
        context.addPath(NSBezierPath(roundedRect: primaryTrackRect, xRadius: 5, yRadius: 5).cgPath)
        context.strokePath()

        let fillWidth = max(5, (primaryTrackRect.width - 2) * primaryPercent)
        let primaryFillRect = CGRect(
            x: primaryTrackRect.minX + 1,
            y: primaryTrackRect.minY + 1,
            width: min(primaryTrackRect.width - 2, fillWidth),
            height: primaryTrackRect.height - 2
        )
        context.setFillColor(meterColor(primaryPercent).cgColor)
        context.addPath(NSBezierPath(roundedRect: primaryFillRect, xRadius: 4, yRadius: 4).cgPath)
        context.fillPath()

        context.setFillColor(NSColor.white.withAlphaComponent(0.12).cgColor)
        context.fill(batteryTipRect)

        context.setFillColor(NSColor.white.withAlphaComponent(0.08).cgColor)
        context.addPath(NSBezierPath(roundedRect: weeklyTrackRect, xRadius: 1, yRadius: 1).cgPath)
        context.fillPath()
        let secondaryFillRect = CGRect(
            x: weeklyTrackRect.minX,
            y: weeklyTrackRect.minY,
            width: weeklyTrackRect.width * secondaryPercent,
            height: weeklyTrackRect.height
        )
        context.setFillColor(NSColor.white.withAlphaComponent(0.46).cgColor)
        context.addPath(NSBezierPath(roundedRect: secondaryFillRect, xRadius: 1, yRadius: 1).cgPath)
        context.fillPath()

        let percentText = String(format: "%.0f%%", usage.primary?.usedPercent ?? 0)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 10, weight: .medium),
            .foregroundColor: NSColor.secondaryLabelColor.withAlphaComponent(0.86)
        ]
        percentText.draw(at: CGPoint(x: 45, y: 0), withAttributes: attributes)
    }

    private func clamp(_ value: Double) -> CGFloat {
        CGFloat(max(0, min(100, value)) / 100)
    }

    private func meterColor(_ ratio: CGFloat) -> NSColor {
        switch ratio {
        case 0.9...:
            return NSColor(calibratedRed: 0.92, green: 0.54, blue: 0.54, alpha: 0.9)
        case 0.75...:
            return NSColor(calibratedRed: 0.92, green: 0.76, blue: 0.54, alpha: 0.9)
        default:
            return NSColor(calibratedWhite: 0.88, alpha: 0.78)
        }
    }

    private func usageTooltip(_ usage: SessionUsageSnapshot) -> String {
        let primary = usage.primary.map { "5h \((Int($0.usedPercent)))%" } ?? "5h unavailable"
        let secondary = usage.secondary.map { "week \((Int($0.usedPercent)))%" } ?? "week unavailable"
        return "\(primary) · \(secondary)"
    }
}

final class OverlayRowView: NSView {
    let sessionId: String

    private let openAction: (String) -> Void
    private let dismissAction: (String) -> Void
    private let repromptAction: (String, String) -> Void
    private let moveAction: (String, NSPoint) -> Void
    private let handleView = NSImageView()
    private let repromptField = NSTextField()
    private var trackingPoint: NSPoint?
    private var draggingFromHandle = false
    private var isDraggingRow = false

    init(
        item: OverlayItem,
        presentation: OverlayPresentation,
        openAction: @escaping (String) -> Void,
        dismissAction: @escaping (String) -> Void,
        repromptAction: @escaping (String, String) -> Void,
        moveAction: @escaping (String, NSPoint) -> Void
    ) {
        self.sessionId = item.sessionId
        self.openAction = openAction
        self.dismissAction = dismissAction
        self.repromptAction = repromptAction
        self.moveAction = moveAction
        super.init(frame: .zero)

        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        layer?.cornerRadius = 18
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.white.withAlphaComponent(0.06).cgColor
        layer?.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 0.34).cgColor

        handleView.image = NSImage(systemSymbolName: "line.3.horizontal", accessibilityDescription: "Reorder")
        handleView.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 10, weight: .medium)
        handleView.contentTintColor = NSColor.tertiaryLabelColor.withAlphaComponent(0.74)
        handleView.translatesAutoresizingMaskIntoConstraints = false

        let dot = NSView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 3
        dot.layer?.backgroundColor = stateColor(item.state).cgColor

        let title = label(item.displayName, size: 15, color: NSColor.labelColor.withAlphaComponent(0.95), weight: .semibold)
        title.lineBreakMode = .byTruncatingTail

        let dismissButton = subtleIconButton(
            systemName: "xmark",
            description: "Dismiss",
            action: #selector(dismissRow(_:)),
            sessionId: item.sessionId
        )

        let topRow = NSStackView()
        topRow.orientation = .horizontal
        topRow.alignment = .centerY
        topRow.spacing = 10
        topRow.translatesAutoresizingMaskIntoConstraints = false
        topRow.addArrangedSubview(handleView)
        topRow.addArrangedSubview(dot)
        topRow.addArrangedSubview(title)
        topRow.addArrangedSubview(spacer())
        if let usage = item.usage {
            topRow.addArrangedSubview(UsageMeterView(usage: usage))
        }
        topRow.addArrangedSubview(dismissButton)

        let summary = label(item.summary, size: 12, color: NSColor.secondaryLabelColor.withAlphaComponent(0.94), weight: .regular)
        summary.lineBreakMode = .byTruncatingTail
        summary.maximumNumberOfLines = presentation.summaryMaxLines

        let repromptContainer = NSView()
        repromptContainer.translatesAutoresizingMaskIntoConstraints = false

        repromptField.isBordered = false
        repromptField.isBezeled = false
        repromptField.drawsBackground = false
        repromptField.focusRingType = .none
        repromptField.font = NSFont.systemFont(ofSize: 12, weight: .regular)
        repromptField.textColor = NSColor.labelColor.withAlphaComponent(0.92)
        repromptField.placeholderString = item.repromptCommand == nil ? "Reprompt unavailable" : "Reprompt…"
        repromptField.isEditable = item.repromptCommand != nil
        repromptField.isSelectable = item.repromptCommand != nil
        repromptField.target = self
        repromptField.action = #selector(submitReprompt(_:))
        repromptField.translatesAutoresizingMaskIntoConstraints = false

        let underline = NSView()
        underline.translatesAutoresizingMaskIntoConstraints = false
        underline.wantsLayer = true
        underline.layer?.cornerRadius = 0.5
        underline.layer?.backgroundColor = NSColor.white.withAlphaComponent(item.repromptCommand == nil ? 0.06 : 0.16).cgColor

        repromptContainer.addSubview(repromptField)
        repromptContainer.addSubview(underline)

        let bodyStack = NSStackView()
        bodyStack.orientation = .vertical
        bodyStack.alignment = .leading
        bodyStack.spacing = 8
        bodyStack.translatesAutoresizingMaskIntoConstraints = false
        bodyStack.addArrangedSubview(topRow)
        if presentation.summaryVisible {
            bodyStack.addArrangedSubview(summary)
        }
        bodyStack.addArrangedSubview(repromptContainer)

        addSubview(bodyStack)
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: CGFloat(presentation.width) - 32),
            dot.widthAnchor.constraint(equalToConstant: 6),
            dot.heightAnchor.constraint(equalToConstant: 6),
            handleView.widthAnchor.constraint(equalToConstant: 12),
            handleView.heightAnchor.constraint(equalToConstant: 12),
            bodyStack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            bodyStack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            bodyStack.topAnchor.constraint(equalTo: topAnchor, constant: 14),
            bodyStack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -14),
            repromptContainer.widthAnchor.constraint(equalTo: bodyStack.widthAnchor),
            repromptField.leadingAnchor.constraint(equalTo: repromptContainer.leadingAnchor),
            repromptField.trailingAnchor.constraint(equalTo: repromptContainer.trailingAnchor),
            repromptField.topAnchor.constraint(equalTo: repromptContainer.topAnchor),
            underline.leadingAnchor.constraint(equalTo: repromptContainer.leadingAnchor),
            underline.trailingAnchor.constraint(equalTo: repromptContainer.trailingAnchor),
            underline.topAnchor.constraint(equalTo: repromptField.bottomAnchor, constant: 5),
            underline.heightAnchor.constraint(equalToConstant: 1),
            underline.bottomAnchor.constraint(equalTo: repromptContainer.bottomAnchor),
            repromptField.heightAnchor.constraint(equalToConstant: 18)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var acceptsFirstResponder: Bool {
        true
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        trackingPoint = point
        draggingFromHandle = handleView.frame.insetBy(dx: -6, dy: -6).contains(point)
        isDraggingRow = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard draggingFromHandle, let start = trackingPoint else {
            return
        }

        let point = convert(event.locationInWindow, from: nil)
        if hypot(point.x - start.x, point.y - start.y) > 6 {
            if !isDraggingRow {
                alphaValue = 0.82
                NSCursor.closedHand.push()
            }
            isDraggingRow = true
        }
    }

    override func mouseUp(with event: NSEvent) {
        defer {
            if isDraggingRow {
                NSCursor.pop()
            }
            alphaValue = 1
            trackingPoint = nil
            draggingFromHandle = false
            isDraggingRow = false
        }

        if draggingFromHandle {
            if isDraggingRow {
                moveAction(sessionId, event.locationInWindow)
            }
            return
        }

        guard let start = trackingPoint else {
            return
        }

        let point = convert(event.locationInWindow, from: nil)
        if hypot(point.x - start.x, point.y - start.y) <= 4 {
            openAction(sessionId)
        }
    }

    @objc private func dismissRow(_ sender: NSButton) {
        dismissAction(sessionId)
    }

    @objc private func submitReprompt(_ sender: NSTextField) {
        let text = sender.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return
        }
        repromptAction(sessionId, text)
    }

    private func label(_ text: String, size: CGFloat, color: NSColor, weight: NSFont.Weight) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = NSFont.systemFont(ofSize: size, weight: weight)
        field.textColor = color
        field.translatesAutoresizingMaskIntoConstraints = false
        return field
    }

    private func spacer() -> NSView {
        let view = NSView()
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return view
    }

    private func subtleIconButton(systemName: String, description: String, action: Selector, sessionId: String) -> NSButton {
        let button = NSButton(title: "", target: self, action: action)
        button.identifier = NSUserInterfaceItemIdentifier(sessionId)
        button.isBordered = false
        button.bezelStyle = .shadowlessSquare
        button.image = NSImage(systemSymbolName: systemName, accessibilityDescription: description)
        button.contentTintColor = NSColor.tertiaryLabelColor.withAlphaComponent(0.88)
        button.imageScaling = .scaleProportionallyDown
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 14),
            button.heightAnchor.constraint(equalToConstant: 14)
        ])
        return button
    }

    private func stateColor(_ state: SummaryState) -> NSColor {
        switch state {
        case .done:
            return NSColor(calibratedRed: 0.45, green: 0.83, blue: 0.63, alpha: 0.95)
        case .blocked:
            return NSColor(calibratedRed: 0.95, green: 0.72, blue: 0.35, alpha: 0.95)
        case .failed:
            return NSColor(calibratedRed: 0.96, green: 0.42, blue: 0.42, alpha: 0.95)
        case .needsInput:
            return NSColor(calibratedRed: 0.53, green: 0.74, blue: 0.98, alpha: 0.95)
        case .ready:
            return NSColor(calibratedWhite: 0.72, alpha: 0.95)
        }
    }
}

final class OverlayApp: NSObject, NSApplicationDelegate {
    private let logger = OverlayLogger.shared
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var overlayWindow: NSWindow?
    private let rootView = FlippedView(frame: NSRect(x: 0, y: 0, width: 384, height: 180))
    private let backgroundView = NSView()
    private let headerTitle = NSTextField(labelWithString: "Codex Beacon")
    private let headerSubtitle = NSTextField(labelWithString: "No waiting sessions")
    private let scrollView = NSScrollView()
    private let rowsContainer = FlippedView(frame: .zero)
    private let stateStore = OverlayStateStore(url: OverlayApp.overlayStateURL())
    private var items: [String: OverlayItem] = [:]
    private var presentation = OverlayPresentation(width: 384, maxVisibleRows: 4, summaryVisible: true, summaryMaxLines: 2)
    private let decoder = JSONDecoder()
    private let snapshotURL = OverlayApp.overlaySnapshotURL()
    private var lastSnapshotRaw = ""
    private var snapshotTimer: Timer?

    override init() {
        super.init()
        bootstrapFromSnapshot()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        logger.log("applicationDidFinishLaunching activationPolicy=accessory snapshotPath=\(snapshotURL.path)")
        configureStatusItem()
        configurePanel()
        loadSnapshotIfNeeded(reason: "did-finish", allowSameRaw: true)
        startSnapshotPolling()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self else {
                return
            }
            self.logger.log("deferredSnapshotReload")
            self.loadSnapshotIfNeeded(reason: "deferred", allowSameRaw: true)
            if !self.items.isEmpty {
                self.showOverlay(reason: "deferred-launch")
            }
        }
    }

    private func bootstrapFromSnapshot() {
        guard let loaded = loadSnapshot() else {
            return
        }
        applySnapshot(
            raw: loaded.raw,
            snapshot: loaded.snapshot,
            reason: "bootstrap",
            allowSameRaw: true,
            shouldRender: false
        )
    }

    private static func overlayStateURL() -> URL {
        if let explicit = ProcessInfo.processInfo.environment["CODEX_BEACON_OVERLAY_STATE_PATH"], !explicit.isEmpty {
            return URL(fileURLWithPath: explicit)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".codex-beacon/overlay-state.json")
    }

    private static func overlaySnapshotURL() -> URL {
        if let explicit = ProcessInfo.processInfo.environment["CODEX_BEACON_OVERLAY_SNAPSHOT_PATH"], !explicit.isEmpty {
            return URL(fileURLWithPath: explicit)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".codex-beacon/overlay-snapshot.json")
    }

    private func configureStatusItem() {
        statusItem.button?.title = "Beacon"
        statusItem.button?.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        statusItem.button?.target = self
        statusItem.button?.action = #selector(toggleOverlay)
        logger.log("configureStatusItem title=Beacon")
    }

    private func configurePanel() {
        logger.log("configurePanel begin")

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 384, height: 180),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        overlayWindow = window

        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.level = .statusBar
        window.ignoresMouseEvents = false
        window.isReleasedWhenClosed = false

        rootView.wantsLayer = true
        rootView.frame = NSRect(x: 0, y: 0, width: presentation.width, height: 180)

        backgroundView.wantsLayer = true
        backgroundView.layer?.cornerRadius = 22
        backgroundView.layer?.masksToBounds = true
        backgroundView.layer?.borderWidth = 1
        backgroundView.layer?.borderColor = NSColor.white.withAlphaComponent(0.08).cgColor
        backgroundView.layer?.backgroundColor = NSColor(calibratedWhite: 0.11, alpha: 0.94).cgColor
        backgroundView.frame = rootView.bounds
        backgroundView.autoresizingMask = [.width, .height]

        headerTitle.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        headerTitle.textColor = NSColor.labelColor.withAlphaComponent(0.94)
        headerTitle.isBezeled = false
        headerTitle.isBordered = false
        headerTitle.drawsBackground = false
        headerTitle.isEditable = false
        headerTitle.isSelectable = false

        headerSubtitle.font = NSFont.systemFont(ofSize: 11, weight: .regular)
        headerSubtitle.textColor = NSColor.secondaryLabelColor
        headerSubtitle.isBezeled = false
        headerSubtitle.isBordered = false
        headerSubtitle.drawsBackground = false
        headerSubtitle.isEditable = false
        headerSubtitle.isSelectable = false

        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay

        rowsContainer.wantsLayer = false
        rowsContainer.frame = NSRect(x: 0, y: 0, width: presentation.width - 32, height: 1)
        scrollView.documentView = rowsContainer

        backgroundView.addSubview(headerTitle)
        backgroundView.addSubview(headerSubtitle)
        backgroundView.addSubview(scrollView)

        rootView.subviews.forEach { $0.removeFromSuperview() }
        rootView.addSubview(backgroundView)
        window.contentView = rootView
        window.orderOut(nil)
        logger.log("configurePanel end")
    }

    private func startSnapshotPolling() {
        snapshotTimer?.invalidate()
        snapshotTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.loadSnapshotIfNeeded(reason: "poll", allowSameRaw: false)
        }
    }

    private func loadSnapshotIfNeeded(reason: String, allowSameRaw: Bool) {
        guard let loaded = loadSnapshot() else {
            return
        }
        applySnapshot(
            raw: loaded.raw,
            snapshot: loaded.snapshot,
            reason: reason,
            allowSameRaw: allowSameRaw,
            shouldRender: true
        )
    }

    private func loadSnapshot() -> (raw: String, snapshot: OverlaySnapshot)? {
        guard let data = try? Data(contentsOf: snapshotURL),
              let raw = String(data: data, encoding: .utf8),
              let snapshot = try? decoder.decode(OverlaySnapshot.self, from: data) else {
            return nil
        }
        return (raw, snapshot)
    }

    private func applySnapshot(
        raw: String,
        snapshot: OverlaySnapshot,
        reason: String,
        allowSameRaw: Bool,
        shouldRender: Bool
    ) {
        if raw == lastSnapshotRaw, !allowSameRaw {
            return
        }
        lastSnapshotRaw = raw

        if let presentation = snapshot.presentation {
            self.presentation = presentation
        }

        var nextItems: [String: OverlayItem] = [:]
        for event in snapshot.items {
            guard event.type == "show", let focusCommand = event.focusCommand else {
                continue
            }

            nextItems[event.sessionId] = OverlayItem(
                sessionId: event.sessionId,
                displayName: event.displayName ?? "Codex",
                summary: event.summary ?? "Ready for your next prompt.",
                state: event.state ?? .ready,
                usage: event.usage,
                timestamp: event.timestamp ?? "",
                focusCommand: focusCommand,
                repromptCommand: event.repromptCommand
            )
        }

        items = nextItems
        logger.log("applySnapshot reason=\(reason) items=\(items.count) render=\(shouldRender)")
        if shouldRender {
            refresh()
            if !items.isEmpty {
                showOverlay(reason: reason)
            }
        }
    }

    private func refresh() {
        logger.log("refresh start items=\(items.count)")
        updateStatusItem()
        headerSubtitle.stringValue = items.isEmpty ? "No waiting sessions" : "\(items.count) waiting"

        guard !items.isEmpty else {
            logger.log("refresh items=0 window=orderOut")
            overlayWindow?.orderOut(nil)
            return
        }

        for subview in rowsContainer.subviews {
            subview.removeFromSuperview()
        }

        let rowWidth = CGFloat(presentation.width) - 32
        let rowHeight: CGFloat = presentation.summaryVisible ? 112 : 86
        var y: CGFloat = 0

        for item in orderedItems() {
            let row = OverlayRowView(
                item: item,
                presentation: presentation,
                openAction: { [weak self] sessionId in
                    self?.openSession(sessionId: sessionId)
                },
                dismissAction: { [weak self] sessionId in
                    self?.dismissSession(sessionId: sessionId)
                },
                repromptAction: { [weak self] sessionId, text in
                    self?.repromptSession(sessionId: sessionId, text: text)
                },
                moveAction: { [weak self] sessionId, point in
                    self?.moveSession(sessionId: sessionId, to: point)
                }
            )
            row.translatesAutoresizingMaskIntoConstraints = true
            row.frame = NSRect(x: 0, y: y, width: rowWidth, height: rowHeight)
            rowsContainer.addSubview(row)
            y += rowHeight + 10
        }

        scrollView.verticalScroller?.alphaValue = items.count > presentation.maxVisibleRows ? 1 : 0
        rowsContainer.frame = NSRect(x: 0, y: 0, width: rowWidth, height: max(1, y - 10))
        layoutPanel()
        logger.log("refresh end arranged=\(rowsContainer.subviews.count)")
    }

    private func orderedItems() -> [OverlayItem] {
        let order = stateStore.orderedIds()
        var arranged: [OverlayItem] = []
        var remaining = items

        for sessionId in order {
            if let item = remaining.removeValue(forKey: sessionId) {
                arranged.append(item)
            }
        }

        let fallback = remaining.values.sorted { left, right in
            if left.timestamp != right.timestamp {
                return left.timestamp > right.timestamp
            }
            return left.displayName < right.displayName
        }
        arranged.append(contentsOf: fallback)
        return arranged
    }

    private func updateStatusItem() {
        statusItem.button?.title = items.isEmpty ? "Beacon" : "Beacon \(items.count)"
    }

    private func layoutPanel() {
        let rowHeight: CGFloat = presentation.summaryVisible ? 112 : 86
        let visibleRows = min(max(items.count, 1), max(presentation.maxVisibleRows, 1))
        let height = 58 + (CGFloat(visibleRows) * rowHeight) + 26
        let width = CGFloat(presentation.width)
        rootView.frame = NSRect(x: 0, y: 0, width: width, height: height)
        backgroundView.frame = rootView.bounds
        headerTitle.frame = NSRect(x: 20, y: 16, width: width - 40, height: 18)
        headerSubtitle.frame = NSRect(x: 20, y: 34, width: width - 40, height: 14)
        scrollView.frame = NSRect(x: 16, y: 58, width: width - 28, height: height - 74)
        guard let window = overlayWindow else {
            logger.log("layoutPanel missingWindow=true")
            return
        }

        if let button = statusItem.button, let buttonWindow = button.window {
            let buttonRectInWindow = button.convert(button.bounds, to: nil)
            let buttonRectOnScreen = buttonWindow.convertToScreen(buttonRectInWindow)
            window.setFrame(
                NSRect(
                    x: buttonRectOnScreen.maxX - width,
                    y: buttonRectOnScreen.minY - height - 6,
                    width: width,
                    height: height
                ),
                display: true
            )
        } else {
            window.setFrame(NSRect(x: 0, y: 0, width: width, height: height), display: true)
        }
        logger.log("layoutPanel frame=\(NSStringFromRect(window.frame))")
    }

    @objc private func toggleOverlay() {
        guard let window = overlayWindow else {
            logger.log("toggleOverlay missingWindow=true")
            return
        }

        if window.isVisible {
            logger.log("toggleOverlay action=hide")
            window.orderOut(nil)
        } else {
            logger.log("toggleOverlay action=show")
            showOverlay(reason: "toggle")
        }
    }

    private func showOverlay(reason: String) {
        guard !items.isEmpty else {
            return
        }
        guard let window = overlayWindow else {
            logger.log("showOverlay reason=\(reason) missingWindow=true")
            return
        }

        window.collectionBehavior = [.canJoinAllSpaces]
        layoutPanel()
        logger.log("showOverlay reason=\(reason) visibleBefore=\(window.isVisible) activeSpaceBefore=\(window.isOnActiveSpace)")
        NSApp.activate(ignoringOtherApps: false)
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        logger.log("showOverlay visibleAfter=\(window.isVisible) activeSpaceAfter=\(window.isOnActiveSpace)")
    }

    private func openSession(sessionId: String) {
        guard let item = items[sessionId] else {
            return
        }
        launch(item.focusCommand)
        dismissSession(sessionId: sessionId)
        overlayWindow?.orderOut(nil)
    }

    private func dismissSession(sessionId: String) {
        items.removeValue(forKey: sessionId)
        stateStore.remove(sessionId: sessionId)
        logger.log("dismissSession sessionId=\(sessionId) remaining=\(items.count)")
        refresh()
    }

    private func repromptSession(sessionId: String, text: String) {
        guard let item = items[sessionId], let repromptCommand = item.repromptCommand else {
            NSSound.beep()
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let success = self?.launch(repromptCommand, extraArgs: [text], waitForExit: true) ?? false
            DispatchQueue.main.async {
                guard success else {
                    NSSound.beep()
                    return
                }
                self?.dismissSession(sessionId: sessionId)
            }
        }
    }

    private func moveSession(sessionId: String, to locationInWindow: NSPoint) {
        let pointInRows = rowsContainer.convert(locationInWindow, from: nil)
        let rows = rowsContainer.subviews.compactMap { $0 as? OverlayRowView }
        let orderedRows = rows.sorted { $0.frame.minY < $1.frame.minY }
        guard let fromIndex = orderedRows.firstIndex(where: { $0.sessionId == sessionId }) else {
            return
        }

        var targetIndex = orderedRows.count - 1
        for (index, row) in orderedRows.enumerated() {
            if pointInRows.y < row.frame.midY {
                targetIndex = index
                break
            }
        }

        if targetIndex == fromIndex {
            return
        }

        var sessionIds = orderedRows.map(\.sessionId)
        let movedId = sessionIds.remove(at: fromIndex)
        sessionIds.insert(movedId, at: targetIndex)
        stateStore.replace(with: sessionIds)
        logger.log("moveSession sessionId=\(sessionId) from=\(fromIndex) to=\(targetIndex)")
        refresh()
    }

    @discardableResult
    private func launch(_ command: CommandSpec, extraArgs: [String] = [], waitForExit: Bool = false) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: command.executable)
        process.arguments = command.args + extraArgs
        do {
            logger.log("launch command=\(command.executable) args=\((command.args + extraArgs).joined(separator: " ")) wait=\(waitForExit)")
            try process.run()
            if waitForExit {
                process.waitUntilExit()
                logger.log("launchExit status=\(process.terminationStatus)")
                return process.terminationStatus == 0
            }
            return true
        } catch {
            logger.log("launchError command=\(command.executable) error=\(error.localizedDescription)")
            return false
        }
    }
}

private extension NSBezierPath {
    var cgPath: CGPath {
        let path = CGMutablePath()
        var points = [NSPoint](repeating: .zero, count: 3)

        for index in 0..<elementCount {
            switch element(at: index, associatedPoints: &points) {
            case .moveTo:
                path.move(to: points[0])
            case .lineTo:
                path.addLine(to: points[0])
            case .curveTo:
                path.addCurve(to: points[2], control1: points[0], control2: points[1])
            case .cubicCurveTo:
                path.addCurve(to: points[2], control1: points[0], control2: points[1])
            case .quadraticCurveTo:
                path.addQuadCurve(to: points[1], control: points[0])
            case .closePath:
                path.closeSubpath()
            @unknown default:
                break
            }
        }

        return path
    }
}

let app = NSApplication.shared
let delegate = OverlayApp()
app.delegate = delegate
app.run()
