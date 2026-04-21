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

final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
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
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let panel = OverlayPanel(
        contentRect: NSRect(x: 0, y: 0, width: 384, height: 180),
        styleMask: [.borderless, .nonactivatingPanel],
        backing: .buffered,
        defer: false
    )
    private let backgroundView = NSVisualEffectView()
    private let headerTitle = NSTextField(labelWithString: "Codex Beacon")
    private let headerSubtitle = NSTextField(labelWithString: "No waiting sessions")
    private let scrollView = NSScrollView()
    private let rowsContainer = NSView()
    private let contentStack = NSStackView()
    private let stateStore = OverlayStateStore(url: OverlayApp.overlayStateURL())
    private var items: [String: OverlayItem] = [:]
    private var presentation = OverlayPresentation(width: 384, maxVisibleRows: 4, summaryVisible: true, summaryMaxLines: 2)
    private let decoder = JSONDecoder()
    private let snapshotURL = OverlayApp.overlaySnapshotURL()
    private var lastSnapshotRaw = ""
    private var snapshotTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureStatusItem()
        configurePanel()
        refresh()
        loadSnapshotIfNeeded()
        startSnapshotPolling()
        readEventsFromStdin()
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
    }

    private func configurePanel() {
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true

        backgroundView.material = .hudWindow
        backgroundView.blendingMode = .behindWindow
        backgroundView.state = .active
        backgroundView.wantsLayer = true
        backgroundView.layer?.cornerRadius = 22
        backgroundView.layer?.masksToBounds = true
        backgroundView.layer?.borderWidth = 1
        backgroundView.layer?.borderColor = NSColor.white.withAlphaComponent(0.08).cgColor
        backgroundView.translatesAutoresizingMaskIntoConstraints = false

        headerTitle.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        headerTitle.textColor = NSColor.labelColor.withAlphaComponent(0.94)
        headerSubtitle.font = NSFont.systemFont(ofSize: 11, weight: .regular)
        headerSubtitle.textColor = NSColor.secondaryLabelColor

        let headerStack = NSStackView(views: [headerTitle, headerSubtitle])
        headerStack.orientation = .vertical
        headerStack.alignment = .leading
        headerStack.spacing = 2
        headerStack.translatesAutoresizingMaskIntoConstraints = false

        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.translatesAutoresizingMaskIntoConstraints = false

        rowsContainer.translatesAutoresizingMaskIntoConstraints = false

        contentStack.orientation = .vertical
        contentStack.alignment = .leading
        contentStack.spacing = 10
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        rowsContainer.addSubview(contentStack)
        NSLayoutConstraint.activate([
            contentStack.leadingAnchor.constraint(equalTo: rowsContainer.leadingAnchor),
            contentStack.trailingAnchor.constraint(equalTo: rowsContainer.trailingAnchor),
            contentStack.topAnchor.constraint(equalTo: rowsContainer.topAnchor),
            contentStack.bottomAnchor.constraint(equalTo: rowsContainer.bottomAnchor),
            rowsContainer.widthAnchor.constraint(equalTo: scrollView.widthAnchor)
        ])
        scrollView.documentView = rowsContainer

        backgroundView.addSubview(headerStack)
        backgroundView.addSubview(scrollView)
        NSLayoutConstraint.activate([
            headerStack.leadingAnchor.constraint(equalTo: backgroundView.leadingAnchor, constant: 20),
            headerStack.trailingAnchor.constraint(equalTo: backgroundView.trailingAnchor, constant: -20),
            headerStack.topAnchor.constraint(equalTo: backgroundView.topAnchor, constant: 16),
            scrollView.leadingAnchor.constraint(equalTo: backgroundView.leadingAnchor, constant: 16),
            scrollView.trailingAnchor.constraint(equalTo: backgroundView.trailingAnchor, constant: -12),
            scrollView.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 14),
            scrollView.bottomAnchor.constraint(equalTo: backgroundView.bottomAnchor, constant: -16)
        ])

        let root = NSView(frame: panel.frame)
        root.addSubview(backgroundView)
        NSLayoutConstraint.activate([
            backgroundView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            backgroundView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            backgroundView.topAnchor.constraint(equalTo: root.topAnchor),
            backgroundView.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])
        panel.contentView = root
    }

    private func readEventsFromStdin() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8) else {
                    continue
                }
                if let event = try? self?.decoder.decode(OverlayEvent.self, from: data) {
                    DispatchQueue.main.async {
                        self?.handle(event)
                    }
                }
            }

            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        }
    }

    private func startSnapshotPolling() {
        snapshotTimer?.invalidate()
        snapshotTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.loadSnapshotIfNeeded()
        }
    }

    private func loadSnapshotIfNeeded() {
        guard let data = try? Data(contentsOf: snapshotURL),
              let raw = String(data: data, encoding: .utf8),
              raw != lastSnapshotRaw,
              let snapshot = try? decoder.decode(OverlaySnapshot.self, from: data) else {
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
        refresh()
        if !items.isEmpty {
            showOverlay()
        }
    }

    private func handle(_ event: OverlayEvent) {
        if let presentation = event.presentation {
            self.presentation = presentation
        }

        if event.type == "clear" {
            items.removeValue(forKey: event.sessionId)
            stateStore.remove(sessionId: event.sessionId)
            refresh()
            return
        }

        guard event.type == "show", let focusCommand = event.focusCommand else {
            return
        }

        items[event.sessionId] = OverlayItem(
            sessionId: event.sessionId,
            displayName: event.displayName ?? "Codex",
            summary: event.summary ?? "Ready for your next prompt.",
            state: event.state ?? .ready,
            usage: event.usage,
            timestamp: event.timestamp ?? "",
            focusCommand: focusCommand,
            repromptCommand: event.repromptCommand
        )
        stateStore.insertIfNeeded(sessionId: event.sessionId)
        refresh()
        showOverlay()
    }

    private func refresh() {
        updateStatusItem()
        headerSubtitle.stringValue = items.isEmpty ? "No waiting sessions" : "\(items.count) waiting"

        for subview in contentStack.arrangedSubviews {
            contentStack.removeArrangedSubview(subview)
            subview.removeFromSuperview()
        }

        guard !items.isEmpty else {
            panel.orderOut(nil)
            return
        }

        for item in orderedItems() {
            contentStack.addArrangedSubview(
                OverlayRowView(
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
            )
        }

        scrollView.verticalScroller?.alphaValue = items.count > presentation.maxVisibleRows ? 1 : 0
        layoutPanel()
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
        let frame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        panel.setFrame(
            NSRect(x: frame.maxX - width - 18, y: frame.maxY - height - 18, width: width, height: height),
            display: true
        )
    }

    @objc private func toggleOverlay() {
        if panel.isVisible {
            panel.orderOut(nil)
        } else {
            showOverlay()
        }
    }

    private func showOverlay() {
        guard !items.isEmpty else {
            return
        }
        layoutPanel()
        panel.orderFrontRegardless()
    }

    private func openSession(sessionId: String) {
        guard let item = items[sessionId] else {
            return
        }
        launch(item.focusCommand)
        dismissSession(sessionId: sessionId)
        panel.orderOut(nil)
    }

    private func dismissSession(sessionId: String) {
        items.removeValue(forKey: sessionId)
        stateStore.remove(sessionId: sessionId)
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
        let pointInStack = contentStack.convert(locationInWindow, from: nil)
        let rows = contentStack.arrangedSubviews.compactMap { $0 as? OverlayRowView }
        let orderedRows = rows.sorted { $0.frame.midY > $1.frame.midY }
        guard let fromIndex = orderedRows.firstIndex(where: { $0.sessionId == sessionId }) else {
            return
        }

        var targetIndex = orderedRows.count - 1
        for (index, row) in orderedRows.enumerated() {
            if pointInStack.y > row.frame.midY {
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
        refresh()
    }

    @discardableResult
    private func launch(_ command: CommandSpec, extraArgs: [String] = [], waitForExit: Bool = false) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: command.executable)
        process.arguments = command.args + extraArgs
        do {
            try process.run()
            if waitForExit {
                process.waitUntilExit()
                return process.terminationStatus == 0
            }
            return true
        } catch {
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
