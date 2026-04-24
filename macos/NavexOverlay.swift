import AppKit
import Carbon.HIToolbox
import Foundation

enum SummaryState: String, Decodable {
    case ready
    case done
    case blocked
    case failed
    case needsInput = "needs-input"
}

enum SessionStatus: String, Decodable {
    case active
    case waiting
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
    let appDisplayName: String?
    let hotkey: String?
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
    let status: SessionStatus?
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
    let status: SessionStatus
    let state: SummaryState
    let usage: SessionUsageSnapshot?
    let timestamp: String
    let focusCommand: CommandSpec
    let repromptCommand: CommandSpec?
}

enum RepromptDisplayState {
    case submitting(token: String)
    case unconfirmed

    var isSubmitting: Bool {
        if case .submitting = self {
            return true
        }
        return false
    }
}

extension Optional where Wrapped == RepromptDisplayState {
    var isSubmitting: Bool {
        self?.isSubmitting == true
    }
}

struct OverlaySnapshot: Decodable {
    let presentation: OverlayPresentation?
    let items: [OverlayEvent]
}

struct OverlayControlCommand: Decodable {
    let action: String
    let commandId: String
    let requestedAt: String
}

struct OverlayStateFile: Codable {
    var orderedSessionIds: [String]
}

final class OverlayLogger {
    static let shared = OverlayLogger()

    private let url: URL?
    private let queue = DispatchQueue(label: "navex.overlay.log")
    private let formatter = ISO8601DateFormatter()

    private init() {
        if let explicit = envValue("NAVEX_OVERLAY_LOG_PATH") {
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

private let overlayIso8601Formatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

private func envValue(_ keys: String...) -> String? {
    for key in keys {
        let value = ProcessInfo.processInfo.environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let value, !value.isEmpty {
            return value
        }
    }
    return nil
}

private func overlayFont(size: CGFloat, weight: NSFont.Weight) -> NSFont {
    NSFont.monospacedSystemFont(ofSize: size, weight: weight)
}

struct HotkeySpec {
    let normalized: String
    let display: String
    let keyCode: UInt32
    let modifiers: UInt32
}

enum HotkeyParseError: Error, CustomStringConvertible {
    case empty
    case missingKey
    case duplicateKey
    case duplicateModifier(String)
    case unsupportedToken(String)

    var description: String {
        switch self {
        case .empty:
            return "empty hotkey"
        case .missingKey:
            return "missing key token"
        case .duplicateKey:
            return "multiple key tokens are not supported"
        case .duplicateModifier(let token):
            return "duplicate modifier: \(token)"
        case .unsupportedToken(let token):
            return "unsupported hotkey token: \(token)"
        }
    }
}

private let hotkeyModifiers: [String: (mask: UInt32, display: String)] = [
    "cmd": (UInt32(cmdKey), "⌘"),
    "command": (UInt32(cmdKey), "⌘"),
    "shift": (UInt32(shiftKey), "⇧"),
    "ctrl": (UInt32(controlKey), "⌃"),
    "control": (UInt32(controlKey), "⌃"),
    "opt": (UInt32(optionKey), "⌥"),
    "option": (UInt32(optionKey), "⌥"),
    "alt": (UInt32(optionKey), "⌥")
]

private let hotkeyKeys: [String: (code: UInt32, display: String)] = [
    "a": (UInt32(kVK_ANSI_A), "A"),
    "b": (UInt32(kVK_ANSI_B), "B"),
    "c": (UInt32(kVK_ANSI_C), "C"),
    "d": (UInt32(kVK_ANSI_D), "D"),
    "e": (UInt32(kVK_ANSI_E), "E"),
    "f": (UInt32(kVK_ANSI_F), "F"),
    "g": (UInt32(kVK_ANSI_G), "G"),
    "h": (UInt32(kVK_ANSI_H), "H"),
    "i": (UInt32(kVK_ANSI_I), "I"),
    "j": (UInt32(kVK_ANSI_J), "J"),
    "k": (UInt32(kVK_ANSI_K), "K"),
    "l": (UInt32(kVK_ANSI_L), "L"),
    "m": (UInt32(kVK_ANSI_M), "M"),
    "n": (UInt32(kVK_ANSI_N), "N"),
    "o": (UInt32(kVK_ANSI_O), "O"),
    "p": (UInt32(kVK_ANSI_P), "P"),
    "q": (UInt32(kVK_ANSI_Q), "Q"),
    "r": (UInt32(kVK_ANSI_R), "R"),
    "s": (UInt32(kVK_ANSI_S), "S"),
    "t": (UInt32(kVK_ANSI_T), "T"),
    "u": (UInt32(kVK_ANSI_U), "U"),
    "v": (UInt32(kVK_ANSI_V), "V"),
    "w": (UInt32(kVK_ANSI_W), "W"),
    "x": (UInt32(kVK_ANSI_X), "X"),
    "y": (UInt32(kVK_ANSI_Y), "Y"),
    "z": (UInt32(kVK_ANSI_Z), "Z"),
    "0": (UInt32(kVK_ANSI_0), "0"),
    "1": (UInt32(kVK_ANSI_1), "1"),
    "2": (UInt32(kVK_ANSI_2), "2"),
    "3": (UInt32(kVK_ANSI_3), "3"),
    "4": (UInt32(kVK_ANSI_4), "4"),
    "5": (UInt32(kVK_ANSI_5), "5"),
    "6": (UInt32(kVK_ANSI_6), "6"),
    "7": (UInt32(kVK_ANSI_7), "7"),
    "8": (UInt32(kVK_ANSI_8), "8"),
    "9": (UInt32(kVK_ANSI_9), "9"),
    ";": (UInt32(kVK_ANSI_Semicolon), ";"),
    ",": (UInt32(kVK_ANSI_Comma), ","),
    ".": (UInt32(kVK_ANSI_Period), "."),
    "/": (UInt32(kVK_ANSI_Slash), "/"),
    "'": (UInt32(kVK_ANSI_Quote), "'"),
    "[": (UInt32(kVK_ANSI_LeftBracket), "["),
    "]": (UInt32(kVK_ANSI_RightBracket), "]"),
    "-": (UInt32(kVK_ANSI_Minus), "-"),
    "=": (UInt32(kVK_ANSI_Equal), "="),
    "`": (UInt32(kVK_ANSI_Grave), "`"),
    "space": (UInt32(kVK_Space), "Space"),
    "return": (UInt32(kVK_Return), "Return"),
    "enter": (UInt32(kVK_Return), "Return"),
    "tab": (UInt32(kVK_Tab), "Tab"),
    "escape": (UInt32(kVK_Escape), "Esc"),
    "esc": (UInt32(kVK_Escape), "Esc")
]

private func parseHotkeySpec(_ raw: String?) throws -> HotkeySpec? {
    guard let raw else {
        return nil
    }

    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if trimmed.isEmpty {
        throw HotkeyParseError.empty
    }

    let tokens = trimmed
        .split(separator: "+")
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    if tokens.isEmpty {
        throw HotkeyParseError.empty
    }

    var modifierMask: UInt32 = 0
    var modifierDisplays: [String] = []
    var seenModifiers = Set<String>()
    var keyToken: String?

    for token in tokens {
        if let modifier = hotkeyModifiers[token] {
            if seenModifiers.contains(modifier.display) {
                throw HotkeyParseError.duplicateModifier(token)
            }
            seenModifiers.insert(modifier.display)
            modifierMask |= modifier.mask
            modifierDisplays.append(modifier.display)
            continue
        }

        if keyToken != nil {
            throw HotkeyParseError.duplicateKey
        }
        keyToken = token
    }

    guard let keyToken else {
        throw HotkeyParseError.missingKey
    }
    guard let key = hotkeyKeys[keyToken] else {
        throw HotkeyParseError.unsupportedToken(keyToken)
    }

    return HotkeySpec(
        normalized: trimmed,
        display: modifierDisplays.joined() + key.display,
        keyCode: key.code,
        modifiers: modifierMask
    )
}

final class HotkeyController {
    fileprivate static let signature = OSType(0x4E565858)
    fileprivate static let hotkeyId: UInt32 = 1

    fileprivate weak var target: OverlayApp?
    private let logger: OverlayLogger
    private var eventHandler: EventHandlerRef?
    private var hotKeyRef: EventHotKeyRef?
    private var registeredSpec: HotkeySpec?

    init(target: OverlayApp, logger: OverlayLogger) {
        self.target = target
        self.logger = logger
        installHandler()
    }

    deinit {
        unregister()
        if let eventHandler {
            RemoveEventHandler(eventHandler)
        }
    }

    func update(spec: HotkeySpec?) {
        if registeredSpec?.normalized == spec?.normalized {
            return
        }

        unregister()
        guard let spec else {
            logger.log("hotkey unregister")
            return
        }

        let hotKeyID = EventHotKeyID(signature: Self.signature, id: Self.hotkeyId)
        let status = RegisterEventHotKey(
            UInt32(spec.keyCode),
            UInt32(spec.modifiers),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        if status == noErr {
            registeredSpec = spec
            logger.log("hotkey register spec=\(spec.normalized) display=\(spec.display)")
        } else {
            hotKeyRef = nil
            logger.log("hotkey registerFailed spec=\(spec.normalized) status=\(status)")
        }
    }

    private func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        registeredSpec = nil
    }

    private func installHandler() {
        var eventSpec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            hotkeyEventCallback,
            1,
            &eventSpec,
            Unmanaged.passUnretained(self).toOpaque(),
            &eventHandler
        )
        if status != noErr {
            logger.log("hotkey handlerInstallFailed status=\(status)")
        }
    }
}

private let hotkeyEventCallback: EventHandlerUPP = { _, eventRef, userData in
    guard let eventRef, let userData else {
        return OSStatus(eventNotHandledErr)
    }

    var hotKeyID = EventHotKeyID()
    let status = GetEventParameter(
        eventRef,
        EventParamName(kEventParamDirectObject),
        EventParamType(typeEventHotKeyID),
        nil,
        MemoryLayout<EventHotKeyID>.size,
        nil,
        &hotKeyID
    )
    if status != noErr || hotKeyID.signature != HotkeyController.signature || hotKeyID.id != HotkeyController.hotkeyId {
        return OSStatus(eventNotHandledErr)
    }

    let controller = Unmanaged<HotkeyController>.fromOpaque(userData).takeUnretainedValue()
    controller.target?.handleGlobalToggleHotkey()
    return noErr
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
        static let bottomInset: CGFloat = 12
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

    private let status: SessionStatus
    private let openAction: (String) -> Void
    private let repromptAction: (String, String) -> Void
    private let moveAction: (String, NSPoint) -> Void
    private let actionButtonsStack = NSStackView()
    private let repromptField = NSTextField()
    private let repromptContainer = NSView()
    private var workingTimer: Timer?
    private var trackingPoint: NSPoint?
    private var isDraggingRow = false

    init(
        item: OverlayItem,
        presentation: OverlayPresentation,
        repromptState: RepromptDisplayState?,
        openAction: @escaping (String) -> Void,
        repromptAction: @escaping (String, String) -> Void,
        moveAction: @escaping (String, NSPoint) -> Void
    ) {
        self.sessionId = item.sessionId
        self.status = item.status
        self.openAction = openAction
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
        repromptField.placeholderString = repromptPlaceholder(for: item, repromptState: repromptState)
        repromptField.isEditable = item.status == .waiting && item.repromptCommand != nil && !repromptState.isSubmitting
        repromptField.isSelectable = item.status == .waiting && item.repromptCommand != nil && !repromptState.isSubmitting
        repromptField.stringValue = initialRepromptValue(for: item, repromptState: repromptState)
        repromptField.target = self
        repromptField.action = #selector(submitReprompt(_:))
        repromptField.translatesAutoresizingMaskIntoConstraints = false

        let underline = NSView()
        underline.translatesAutoresizingMaskIntoConstraints = false
        underline.wantsLayer = true
        underline.layer?.cornerRadius = 0.5
        underline.layer?.backgroundColor = underlineColor(for: item, repromptState: repromptState).cgColor

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

        if item.status == .active {
            startStatusAnimation(frames: ["Working.", "Working..", "Working...", "Working.."])
        } else if repromptState.isSubmitting {
            startStatusAnimation(frames: ["Submitting.", "Submitting..", "Submitting...", "Submitting.."])
        }
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        workingTimer?.invalidate()
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
        if status == .active {
            return NSColor(calibratedRed: 0.43, green: 0.71, blue: 0.98, alpha: 0.98)
        }

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

    private func repromptPlaceholder(for item: OverlayItem, repromptState: RepromptDisplayState?) -> String {
        if item.status == .active {
            return "Working."
        }
        if case .unconfirmed = repromptState {
            return "Reprompt not confirmed"
        }
        return item.repromptCommand == nil ? "Reprompt unavailable" : "Reprompt…"
    }

    private func initialRepromptValue(for item: OverlayItem, repromptState: RepromptDisplayState?) -> String {
        if item.status == .active {
            return "Working."
        }
        if repromptState.isSubmitting {
            return "Submitting."
        }
        return ""
    }

    private func underlineColor(for item: OverlayItem, repromptState: RepromptDisplayState?) -> NSColor {
        if item.status == .active {
            return NSColor(calibratedRed: 0.43, green: 0.71, blue: 0.98, alpha: 0.26)
        }
        if repromptState.isSubmitting {
            return NSColor(calibratedRed: 0.43, green: 0.71, blue: 0.98, alpha: 0.22)
        }
        if case .unconfirmed = repromptState {
            return NSColor(calibratedRed: 0.96, green: 0.42, blue: 0.42, alpha: 0.24)
        }
        return NSColor.white.withAlphaComponent(item.repromptCommand == nil ? 0.06 : 0.16)
    }

    private func startStatusAnimation(frames: [String]) {
        var index = 0
        repromptField.stringValue = frames[index]
        workingTimer = Timer.scheduledTimer(withTimeInterval: 0.38, repeats: true) { [weak self] timer in
            guard let self else {
                timer.invalidate()
                return
            }
            index = (index + 1) % frames.count
            self.repromptField.stringValue = frames[index]
        }
    }
}

final class OverlayApp: NSObject, NSApplicationDelegate {
    private enum LayoutMetrics {
        static let headerHeight: CGFloat = 66
        static let footerHeight: CGFloat = 16
        static let rowSpacing: CGFloat = 10
    }
    private enum RepromptMetrics {
        static let confirmationTimeout: TimeInterval = 6
    }

    private let logger = OverlayLogger.shared
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var overlayWindow: NSWindow?
    private let rootView = FlippedView(frame: NSRect(x: 0, y: 0, width: 384, height: 180))
    private let backgroundView = FlippedView()
    private let headerTitle = NSTextField(labelWithString: "Navex")
    private let headerSubtitle = NSTextField(labelWithString: "No live sessions")
    private let headerUsagePrimary = NSTextField(labelWithString: "")
    private let headerUsageSecondary = NSTextField(labelWithString: "")
    private let scrollView = NSScrollView()
    private let rowsContainer = FlippedView(frame: .zero)
    private let stateStore = OverlayStateStore(url: OverlayApp.overlayStateURL())
    private var items: [String: OverlayItem] = [:]
    private var presentation = OverlayPresentation(appDisplayName: "Navex", hotkey: "cmd+shift+;", width: 384, maxVisibleRows: 4, summaryVisible: true, summaryMaxLines: 2)
    private let decoder = JSONDecoder()
    private let snapshotURL = OverlayApp.overlaySnapshotURL()
    private let controlURL = OverlayApp.overlayControlURL()
    private var lastSnapshotRaw = ""
    private var snapshotTimer: Timer?
    private var controlTimer: Timer?
    private let showOnLaunch = envValue("NAVEX_OVERLAY_SHOW_ON_LAUNCH") == "1"
    private var visibleRowsContentHeight: CGFloat = 1
    private var lastHandledControlId = ""
    private var repromptStates: [String: RepromptDisplayState] = [:]
    private lazy var hotkeyController = HotkeyController(target: self, logger: logger)

    override init() {
        super.init()
        bootstrapFromSnapshot()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        logger.log("applicationDidFinishLaunching activationPolicy=accessory snapshotPath=\(snapshotURL.path)")
        configureStatusItem()
        configurePanel()
        updateHotkeyRegistration()
        loadSnapshotIfNeeded(reason: "did-finish", allowSameRaw: true)
        startSnapshotPolling()
        startControlPolling()
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
        if let explicit = envValue("NAVEX_OVERLAY_STATE_PATH") {
            return URL(fileURLWithPath: explicit)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".navex/overlay-state.json")
    }

    private static func overlaySnapshotURL() -> URL {
        if let explicit = envValue("NAVEX_OVERLAY_SNAPSHOT_PATH") {
            return URL(fileURLWithPath: explicit)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".navex/overlay-snapshot.json")
    }

    private static func overlayControlURL() -> URL {
        if let explicit = envValue("NAVEX_OVERLAY_CONTROL_PATH") {
            return URL(fileURLWithPath: explicit)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".navex/overlay-control.json")
    }

    private func configureStatusItem() {
        statusItem.button?.title = statusItemTitle()
        statusItem.button?.font = overlayFont(size: 12, weight: .medium)
        statusItem.button?.target = self
        statusItem.button?.action = #selector(toggleOverlay)
        statusItem.button?.toolTip = statusItemTooltip()
        logger.log("configureStatusItem title=\(statusItemTitle())")
    }

    private func configurePanel() {
        logger.log("configurePanel begin")

        let window = OverlayWindow(
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

    private func startControlPolling() {
        controlTimer?.invalidate()
        controlTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            self?.applyOverlayControlIfNeeded()
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

    private func applyOverlayControlIfNeeded() {
        guard let data = try? Data(contentsOf: controlURL),
              let command = try? decoder.decode(OverlayControlCommand.self, from: data) else {
            return
        }

        if command.commandId == lastHandledControlId {
            return
        }
        lastHandledControlId = command.commandId

        guard let requestedAt = overlayIso8601Formatter.date(from: command.requestedAt) else {
            logger.log("applyOverlayControl invalidDate commandId=\(command.commandId)")
            return
        }
        if Date().timeIntervalSince(requestedAt) > 20 {
            logger.log("applyOverlayControl stale action=\(command.action) commandId=\(command.commandId)")
            return
        }

        logger.log("applyOverlayControl action=\(command.action) commandId=\(command.commandId)")
        switch command.action {
        case "show":
            showOverlay(reason: "control-show")
        case "hide":
            hideOverlay(reason: "control-hide")
        case "toggle":
            if overlayWindow?.isVisible == true {
                hideOverlay(reason: "control-toggle-hide")
            } else {
                showOverlay(reason: "control-toggle-show")
            }
        default:
            break
        }
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
        headerTitle.stringValue = currentAppDisplayName()
        updateHotkeyRegistration()

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
                status: event.status ?? .waiting,
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
        for sessionId in removedIds {
            stateStore.remove(sessionId: sessionId)
            repromptStates.removeValue(forKey: sessionId)
        }
        for item in nextItems.values where item.status == .active {
            repromptStates.removeValue(forKey: item.sessionId)
        }
        logger.log("applySnapshot reason=\(reason) items=\(items.count) added=\(addedIds.count) removed=\(removedIds.count) render=\(shouldRender)")
        if shouldRender {
            refresh()
            if !addedIds.isEmpty && addedIds.contains(where: { nextItems[$0]?.status == .waiting }) {
                showOverlay(reason: reason)
            } else if items.isEmpty && !removedIds.isEmpty {
                hideOverlay(reason: "\(reason)-clear")
            }
        }
    }

    private func refresh() {
        logger.log("refresh start items=\(items.count)")
        headerTitle.stringValue = currentAppDisplayName()
        updateStatusItem()
        headerSubtitle.stringValue = headerSubtitleText()
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
                repromptState: repromptStates[item.sessionId],
                openAction: { [weak self] sessionId in
                    self?.openSession(sessionId: sessionId)
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
        statusItem.button?.title = statusItemTitle()
        statusItem.button?.toolTip = statusItemTooltip()
    }

    private func statusItemTitle() -> String {
        let base = currentAppDisplayName()
        return items.isEmpty ? base : "\(base) \(items.count)"
    }

    private func currentAppDisplayName() -> String {
        if let configured = presentation.appDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines), !configured.isEmpty {
            return configured
        }
        return "Navex"
    }

    private func statusItemTooltip() -> String {
        if let spec = resolvedHotkeySpec() {
            return "\(currentAppDisplayName()) overlay toggle: \(spec.display)"
        }
        return "\(currentAppDisplayName()) overlay"
    }

    private func headerSubtitleText() -> String {
        guard !items.isEmpty else {
            return "No live sessions"
        }

        let waitingCount = items.values.filter { $0.status == .waiting }.count
        let activeCount = items.count - waitingCount
        if waitingCount == 0 {
            return "\(items.count) live"
        }
        if activeCount == 0 {
            return "\(waitingCount) waiting"
        }
        return "\(items.count) live · \(waitingCount) waiting"
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

    fileprivate func handleGlobalToggleHotkey() {
        logger.log("hotkey pressed")
        DispatchQueue.main.async { [weak self] in
            self?.toggleOverlay()
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

    private func updateHotkeyRegistration() {
        hotkeyController.update(spec: resolvedHotkeySpec())
    }

    private func resolvedHotkeySpec() -> HotkeySpec? {
        do {
            return try parseHotkeySpec(presentation.hotkey)
        } catch {
            logger.log("hotkey parseFailed raw=\(presentation.hotkey ?? "nil") error=\(error)")
            return nil
        }
    }

    private func openSession(sessionId: String) {
        guard let item = items[sessionId] else {
            return
        }
        launch(item.focusCommand)
        overlayWindow?.orderOut(nil)
    }

    private func repromptSession(sessionId: String, text: String) {
        guard let item = items[sessionId], let repromptCommand = item.repromptCommand else {
            NSSound.beep()
            return
        }

        let token = UUID().uuidString
        repromptStates[sessionId] = .submitting(token: token)
        refresh()

        DispatchQueue.main.asyncAfter(deadline: .now() + RepromptMetrics.confirmationTimeout) { [weak self] in
            guard let self else {
                return
            }
            guard case .submitting(let currentToken) = self.repromptStates[sessionId], currentToken == token else {
                return
            }
            if self.items[sessionId]?.status == .active {
                self.repromptStates.removeValue(forKey: sessionId)
            } else {
                self.repromptStates[sessionId] = .unconfirmed
            }
            self.refresh()
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let success = self?.launch(repromptCommand, extraArgs: [text], waitForExit: true) ?? false
            DispatchQueue.main.async {
                guard let self else {
                    return
                }
                if success {
                    return
                }
                guard case .submitting(let currentToken) = self.repromptStates[sessionId], currentToken == token else {
                    return
                }
                self.repromptStates[sessionId] = .unconfirmed
                self.refresh()
                NSSound.beep()
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
