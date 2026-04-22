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

private func overlayFont(size: CGFloat, weight: NSFont.Weight) -> NSFont {
    NSFont.monospacedSystemFont(ofSize: size, weight: weight)
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

final class OverlayRowView: NSView {
    private enum Metrics {
        static let horizontalInset: CGFloat = 16
        static let topInset: CGFloat = 13
        static let bottomInset: CGFloat = 10
        static let contentSpacing: CGFloat = 6
        static let titleSpacing: CGFloat = 8
        static let actionSpacing: CGFloat = 6
        static let actionButtonSize: CGFloat = 16
        static let contentToActionsGap: CGFloat = 14
        static let dotSize: CGFloat = 6
        static let summaryMinHeight: CGFloat = 16
        static let repromptHeight: CGFloat = 16
        static let underlineTop: CGFloat = 3
    }

    let sessionId: String

    private let openAction: (String) -> Void
    private let dismissAction: (String) -> Void
    private let repromptAction: (String, String) -> Void
    private let moveAction: (String, NSPoint) -> Void
    private let actionButtonsStack = NSStackView()
    private let repromptField = NSTextField()
    private let repromptContainer = NSView()
    private var trackingPoint: NSPoint?
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

        let dot = NSView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 3
        dot.layer?.backgroundColor = stateColor(item.state).cgColor

        let title = label(item.displayName, size: 13, color: NSColor.labelColor.withAlphaComponent(0.95), weight: .semibold)
        title.lineBreakMode = .byTruncatingTail

        let actionTint = NSColor.tertiaryLabelColor.withAlphaComponent(0.88)

        let dismissButton = subtleIconButton(
            systemName: "xmark",
            description: "Dismiss",
            action: #selector(dismissRow(_:)),
            sessionId: item.sessionId,
            tintColor: actionTint
        )

        let openButton = subtleIconButton(
            systemName: "arrow.up.right",
            description: "Open session",
            action: #selector(openRow(_:)),
            sessionId: item.sessionId,
            tintColor: actionTint
        )

        actionButtonsStack.orientation = .vertical
        actionButtonsStack.alignment = .centerX
        actionButtonsStack.spacing = Metrics.actionSpacing
        actionButtonsStack.translatesAutoresizingMaskIntoConstraints = false
        actionButtonsStack.setContentCompressionResistancePriority(.required, for: .vertical)
        actionButtonsStack.setContentHuggingPriority(.required, for: .vertical)
        actionButtonsStack.addArrangedSubview(dismissButton)
        actionButtonsStack.addArrangedSubview(openButton)

        let titleRow = NSStackView()
        titleRow.orientation = .horizontal
        titleRow.alignment = .centerY
        titleRow.spacing = Metrics.titleSpacing
        titleRow.translatesAutoresizingMaskIntoConstraints = false
        titleRow.setContentCompressionResistancePriority(.required, for: .vertical)
        titleRow.setContentHuggingPriority(.required, for: .vertical)
        titleRow.addArrangedSubview(title)
        titleRow.addArrangedSubview(dot)

        let summary = NSTextField(wrappingLabelWithString: item.summary)
        summary.font = overlayFont(size: 11, weight: .medium)
        summary.textColor = NSColor.secondaryLabelColor.withAlphaComponent(0.94)
        summary.translatesAutoresizingMaskIntoConstraints = false
        summary.lineBreakMode = .byTruncatingTail
        summary.maximumNumberOfLines = presentation.summaryMaxLines
        summary.cell?.wraps = true
        summary.cell?.usesSingleLineMode = false
        summary.cell?.truncatesLastVisibleLine = true
        summary.setContentCompressionResistancePriority(.required, for: .vertical)
        summary.setContentHuggingPriority(.required, for: .vertical)

        let contentColumn = NSView()
        contentColumn.translatesAutoresizingMaskIntoConstraints = false

        repromptContainer.translatesAutoresizingMaskIntoConstraints = false

        repromptField.isBordered = false
        repromptField.isBezeled = false
        repromptField.drawsBackground = false
        repromptField.focusRingType = .none
        repromptField.font = overlayFont(size: 11, weight: .medium)
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
        bodyStack.spacing = Metrics.contentSpacing
        bodyStack.translatesAutoresizingMaskIntoConstraints = false
        bodyStack.addArrangedSubview(titleRow)
        if presentation.summaryVisible {
            bodyStack.addArrangedSubview(summary)
        }
        bodyStack.addArrangedSubview(repromptContainer)

        addSubview(contentColumn)
        contentColumn.addSubview(bodyStack)
        addSubview(actionButtonsStack)
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: CGFloat(presentation.width) - 32),
            dot.widthAnchor.constraint(equalToConstant: Metrics.dotSize),
            dot.heightAnchor.constraint(equalToConstant: Metrics.dotSize),
            title.widthAnchor.constraint(lessThanOrEqualTo: contentColumn.widthAnchor),
            summary.widthAnchor.constraint(equalTo: contentColumn.widthAnchor),
            summary.heightAnchor.constraint(greaterThanOrEqualToConstant: Metrics.summaryMinHeight),
            contentColumn.leadingAnchor.constraint(equalTo: leadingAnchor, constant: Metrics.horizontalInset),
            contentColumn.topAnchor.constraint(equalTo: topAnchor, constant: Metrics.topInset),
            contentColumn.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -Metrics.bottomInset),
            contentColumn.trailingAnchor.constraint(equalTo: actionButtonsStack.leadingAnchor, constant: -Metrics.contentToActionsGap),
            bodyStack.leadingAnchor.constraint(equalTo: contentColumn.leadingAnchor),
            bodyStack.trailingAnchor.constraint(equalTo: contentColumn.trailingAnchor),
            bodyStack.topAnchor.constraint(equalTo: contentColumn.topAnchor),
            bodyStack.bottomAnchor.constraint(equalTo: contentColumn.bottomAnchor),
            repromptContainer.widthAnchor.constraint(equalTo: contentColumn.widthAnchor),
            repromptField.leadingAnchor.constraint(equalTo: repromptContainer.leadingAnchor),
            repromptField.trailingAnchor.constraint(equalTo: repromptContainer.trailingAnchor),
            repromptField.topAnchor.constraint(equalTo: repromptContainer.topAnchor),
            underline.leadingAnchor.constraint(equalTo: repromptContainer.leadingAnchor),
            underline.trailingAnchor.constraint(equalTo: repromptContainer.trailingAnchor),
            underline.topAnchor.constraint(equalTo: repromptField.bottomAnchor, constant: Metrics.underlineTop),
            underline.heightAnchor.constraint(equalToConstant: 1),
            underline.bottomAnchor.constraint(equalTo: repromptContainer.bottomAnchor),
            repromptField.heightAnchor.constraint(equalToConstant: Metrics.repromptHeight),
            actionButtonsStack.topAnchor.constraint(equalTo: topAnchor, constant: Metrics.topInset),
            actionButtonsStack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -Metrics.horizontalInset),
            actionButtonsStack.widthAnchor.constraint(equalToConstant: Metrics.actionButtonSize)
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
        guard !isInteractiveArea(point) else {
            trackingPoint = nil
            isDraggingRow = false
            return
        }
        trackingPoint = point
        isDraggingRow = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = trackingPoint else {
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
            isDraggingRow = false
        }

        guard trackingPoint != nil else {
            return
        }

        if isDraggingRow {
            moveAction(sessionId, event.locationInWindow)
        }
    }

    @objc private func dismissRow(_ sender: NSButton) {
        dismissAction(sessionId)
    }

    @objc private func openRow(_ sender: NSButton) {
        openAction(sessionId)
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
        field.font = overlayFont(size: size, weight: weight)
        field.textColor = color
        field.translatesAutoresizingMaskIntoConstraints = false
        return field
    }

    private func subtleIconButton(systemName: String, description: String, action: Selector, sessionId: String, tintColor: NSColor) -> NSButton {
        let button = NSButton(title: "", target: self, action: action)
        button.identifier = NSUserInterfaceItemIdentifier(sessionId)
        button.isBordered = false
        button.bezelStyle = .shadowlessSquare
        button.image = NSImage(
            systemSymbolName: systemName,
            accessibilityDescription: description
        )?.withSymbolConfiguration(.init(pointSize: 12, weight: .medium))
        button.contentTintColor = tintColor
        button.imageScaling = .scaleProportionallyDown
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: Metrics.actionButtonSize),
            button.heightAnchor.constraint(equalToConstant: Metrics.actionButtonSize)
        ])
        return button
    }

    private func isInteractiveArea(_ point: NSPoint) -> Bool {
        let actionRect = convert(actionButtonsStack.bounds, from: actionButtonsStack).insetBy(dx: -8, dy: -8)
        if actionRect.contains(point) {
            return true
        }

        let repromptRect = convert(repromptContainer.bounds, from: repromptContainer).insetBy(dx: 0, dy: -4)
        return repromptRect.contains(point)
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
    private enum LayoutMetrics {
        static let headerHeight: CGFloat = 66
        static let footerHeight: CGFloat = 16
        static let rowSpacing: CGFloat = 10
    }

    private let logger = OverlayLogger.shared
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var overlayWindow: NSWindow?
    private let rootView = FlippedView(frame: NSRect(x: 0, y: 0, width: 384, height: 180))
    private let backgroundView = FlippedView()
    private let headerTitle = NSTextField(labelWithString: "Codex Beacon")
    private let headerSubtitle = NSTextField(labelWithString: "No waiting sessions")
    private let headerUsagePrimary = NSTextField(labelWithString: "")
    private let headerUsageSecondary = NSTextField(labelWithString: "")
    private let scrollView = NSScrollView()
    private let rowsContainer = FlippedView(frame: .zero)
    private let stateStore = OverlayStateStore(url: OverlayApp.overlayStateURL())
    private var items: [String: OverlayItem] = [:]
    private var presentation = OverlayPresentation(width: 384, maxVisibleRows: 4, summaryVisible: true, summaryMaxLines: 2)
    private let decoder = JSONDecoder()
    private let snapshotURL = OverlayApp.overlaySnapshotURL()
    private var lastSnapshotRaw = ""
    private var snapshotTimer: Timer?
    private let showOnLaunch = ProcessInfo.processInfo.environment["CODEX_BEACON_OVERLAY_SHOW_ON_LAUNCH"] == "1"
    private var visibleRowsContentHeight: CGFloat = 1

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
            if self.showOnLaunch, !self.items.isEmpty {
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
        statusItem.button?.font = overlayFont(size: 12, weight: .medium)
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

        headerTitle.font = overlayFont(size: 12, weight: .semibold)
        headerTitle.textColor = NSColor.labelColor.withAlphaComponent(0.94)
        headerTitle.isBezeled = false
        headerTitle.isBordered = false
        headerTitle.drawsBackground = false
        headerTitle.isEditable = false
        headerTitle.isSelectable = false

        headerSubtitle.font = overlayFont(size: 11, weight: .medium)
        headerSubtitle.textColor = NSColor.secondaryLabelColor
        headerSubtitle.isBezeled = false
        headerSubtitle.isBordered = false
        headerSubtitle.drawsBackground = false
        headerSubtitle.isEditable = false
        headerSubtitle.isSelectable = false

        headerUsagePrimary.font = overlayFont(size: 11, weight: .medium)
        headerUsagePrimary.textColor = NSColor.labelColor.withAlphaComponent(0.88)
        headerUsagePrimary.alignment = .right
        headerUsagePrimary.isBezeled = false
        headerUsagePrimary.isBordered = false
        headerUsagePrimary.drawsBackground = false
        headerUsagePrimary.isEditable = false
        headerUsagePrimary.isSelectable = false
        headerUsagePrimary.lineBreakMode = .byTruncatingHead

        headerUsageSecondary.font = overlayFont(size: 11, weight: .medium)
        headerUsageSecondary.textColor = NSColor.secondaryLabelColor.withAlphaComponent(0.92)
        headerUsageSecondary.alignment = .right
        headerUsageSecondary.isBezeled = false
        headerUsageSecondary.isBordered = false
        headerUsageSecondary.drawsBackground = false
        headerUsageSecondary.isEditable = false
        headerUsageSecondary.isSelectable = false
        headerUsageSecondary.lineBreakMode = .byTruncatingHead

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
        backgroundView.addSubview(headerUsagePrimary)
        backgroundView.addSubview(headerUsageSecondary)
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

        let previousIds = Set(items.keys)
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

        let nextIds = Set(nextItems.keys)
        let addedIds = nextIds.subtracting(previousIds)
        let removedIds = previousIds.subtracting(nextIds)
        items = nextItems
        logger.log("applySnapshot reason=\(reason) items=\(items.count) added=\(addedIds.count) removed=\(removedIds.count) render=\(shouldRender)")
        if shouldRender {
            refresh()
            if !addedIds.isEmpty {
                showOverlay(reason: reason)
            } else if !removedIds.isEmpty {
                hideOverlay(reason: "\(reason)-clear")
            }
        }
    }

    private func refresh() {
        logger.log("refresh start items=\(items.count)")
        updateStatusItem()
        headerSubtitle.stringValue = items.isEmpty ? "No waiting sessions" : "\(items.count) waiting"
        updateHeaderUsage()

        guard !items.isEmpty else {
            logger.log("refresh items=0 window=orderOut")
            overlayWindow?.orderOut(nil)
            return
        }

        for subview in rowsContainer.subviews {
            subview.removeFromSuperview()
        }

        let rowWidth = CGFloat(presentation.width) - 32
        var y: CGFloat = 0
        var rowHeights: [CGFloat] = []

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
            let rowHeight = measuredRowHeight(for: row, width: rowWidth)
            row.translatesAutoresizingMaskIntoConstraints = true
            row.frame = NSRect(x: 0, y: y, width: rowWidth, height: rowHeight)
            rowsContainer.addSubview(row)
            rowHeights.append(rowHeight)
            y += rowHeight + LayoutMetrics.rowSpacing
        }

        scrollView.verticalScroller?.alphaValue = items.count > presentation.maxVisibleRows ? 1 : 0
        visibleRowsContentHeight = contentHeight(for: rowHeights, visibleCount: presentation.maxVisibleRows)
        rowsContainer.frame = NSRect(
            x: 0,
            y: 0,
            width: rowWidth,
            height: max(1, contentHeight(for: rowHeights, visibleCount: rowHeights.count))
        )
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
        let height = LayoutMetrics.headerHeight + max(visibleRowsContentHeight, 1) + LayoutMetrics.footerHeight
        let width = CGFloat(presentation.width)
        let usageWidth: CGFloat = 214
        let leftWidth = max(132, width - usageWidth - 54)
        rootView.frame = NSRect(x: 0, y: 0, width: width, height: height)
        backgroundView.frame = rootView.bounds
        headerTitle.frame = NSRect(x: 20, y: 14, width: leftWidth, height: 17)
        headerSubtitle.frame = NSRect(x: 20, y: 33, width: leftWidth, height: 14)
        headerUsagePrimary.frame = NSRect(x: width - usageWidth - 20, y: 14, width: usageWidth, height: 14)
        headerUsageSecondary.frame = NSRect(x: width - usageWidth - 20, y: 31, width: usageWidth, height: 14)
        scrollView.frame = NSRect(x: 16, y: 66, width: width - 28, height: height - 82)
        guard let window = overlayWindow else {
            logger.log("layoutPanel missingWindow=true")
            return
        }

        if let visibleFrame = currentScreenVisibleFrame() {
            window.setFrame(
                NSRect(
                    x: visibleFrame.maxX - width - 18,
                    y: visibleFrame.maxY - height - 14,
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

    private func measuredRowHeight(for row: OverlayRowView, width: CGFloat) -> CGFloat {
        row.frame = NSRect(x: 0, y: 0, width: width, height: 1)
        row.needsLayout = true
        row.layoutSubtreeIfNeeded()
        return max(1, ceil(row.fittingSize.height))
    }

    private func contentHeight(for rowHeights: [CGFloat], visibleCount: Int) -> CGFloat {
        let clampedCount = max(0, min(rowHeights.count, visibleCount))
        guard clampedCount > 0 else {
            return 1
        }

        let visibleHeights = rowHeights.prefix(clampedCount)
        let spacing = CGFloat(max(clampedCount - 1, 0)) * LayoutMetrics.rowSpacing
        return visibleHeights.reduce(0, +) + spacing
    }

    private func updateHeaderUsage() {
        guard let usage = latestUsageSnapshot() else {
            headerUsagePrimary.stringValue = ""
            headerUsageSecondary.stringValue = ""
            return
        }

        headerUsagePrimary.stringValue = usageHeaderLine(label: nil, snapshot: usage.primary) ?? ""
        headerUsageSecondary.stringValue = usageHeaderLine(label: nil, snapshot: usage.secondary) ?? ""
    }

    private func latestUsageSnapshot() -> SessionUsageSnapshot? {
        items.values
            .compactMap(\.usage)
            .max { left, right in
                let leftKey = left.capturedAt ?? ""
                let rightKey = right.capturedAt ?? ""
                return leftKey < rightKey
            }
    }

    private func usageHeaderLine(label: String?, snapshot: UsageWindowSnapshot?) -> String? {
        guard let snapshot else {
            return nil
        }

        let percentLeft = max(0, min(100, Int((100 - snapshot.usedPercent).rounded())))
        let prefix = label.map { "\($0) " } ?? ""
        if let resetText = resetText(from: snapshot.resetsAt) {
            return "\(prefix)\(percentLeft)% left  \(resetText)"
        }
        return "\(prefix)\(percentLeft)% left"
    }

    private func resetText(from timestamp: Double?) -> String? {
        guard let timestamp else {
            return nil
        }

        let resetDate = Date(timeIntervalSince1970: timestamp)
        let calendar = Calendar.current
        let timeFormatter = DateFormatter()
        timeFormatter.locale = Locale(identifier: "en_US_POSIX")
        timeFormatter.dateFormat = "HH:mm"

        if calendar.isDateInToday(resetDate) {
            return timeFormatter.string(from: resetDate)
        }

        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.dateFormat = "d MMM HH:mm"
        return dateFormatter.string(from: resetDate)
    }

    private func currentScreenVisibleFrame() -> NSRect? {
        let mouseLocation = NSEvent.mouseLocation
        if let screen = NSScreen.screens.first(where: { NSMouseInRect(mouseLocation, $0.frame, false) }) {
            return screen.visibleFrame
        }

        if let screen = statusItem.button?.window?.screen {
            return screen.visibleFrame
        }

        return NSScreen.main?.visibleFrame
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

    private func hideOverlay(reason: String) {
        guard let window = overlayWindow else {
            logger.log("hideOverlay reason=\(reason) missingWindow=true")
            return
        }

        logger.log("hideOverlay reason=\(reason) visibleBefore=\(window.isVisible)")
        window.orderOut(nil)
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
