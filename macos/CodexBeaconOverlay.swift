import AppKit
import Foundation

enum SummaryState: String, Decodable {
    case ready
    case done
    case blocked
    case failed
    case needsInput = "needs-input"
}

struct FocusCommand: Decodable {
    let executable: String
    let args: [String]
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
    let timestamp: String?
    let focusCommand: FocusCommand?
    let presentation: OverlayPresentation?
}

struct OverlayItem {
    let sessionId: String
    let displayName: String
    let summary: String
    let state: SummaryState
    let timestamp: String
    let focusCommand: FocusCommand
}

final class OverlayApp: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let panel = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 384, height: 160),
        styleMask: [.borderless, .nonactivatingPanel],
        backing: .buffered,
        defer: false
    )
    private let backgroundView = NSVisualEffectView()
    private let headerTitle = NSTextField(labelWithString: "Beacon")
    private let headerSubtitle = NSTextField(labelWithString: "No waiting sessions")
    private let scrollView = NSScrollView()
    private let rowsContainer = NSView()
    private let contentStack = NSStackView()
    private var items: [String: OverlayItem] = [:]
    private var presentation = OverlayPresentation(width: 384, maxVisibleRows: 4, summaryVisible: true, summaryMaxLines: 2)
    private let decoder = JSONDecoder()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureStatusItem()
        configurePanel()
        refresh()
        readEventsFromStdin()
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
                do {
                    if let event = try self?.decoder.decode(OverlayEvent.self, from: data) {
                        DispatchQueue.main.async {
                            self?.handle(event)
                        }
                    }
                } catch {
                    continue
                }
            }

            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        }
    }

    private func handle(_ event: OverlayEvent) {
        if let presentation = event.presentation {
            self.presentation = presentation
        }

        if event.type == "clear" {
            items.removeValue(forKey: event.sessionId)
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
            timestamp: event.timestamp ?? "",
            focusCommand: focusCommand
        )
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

        if items.isEmpty {
            panel.orderOut(nil)
            return
        }

        let visibleItems = items.values
            .sorted(by: { $0.displayName < $1.displayName })

        for item in visibleItems {
            contentStack.addArrangedSubview(makeRow(for: item))
        }

        scrollView.verticalScroller?.alphaValue = items.count > presentation.maxVisibleRows ? 1 : 0
        layoutPanel()
    }

    private func updateStatusItem() {
        let title = items.isEmpty ? "Beacon" : "Beacon \(items.count)"
        statusItem.button?.title = title
    }

    private func makeRow(for item: OverlayItem) -> NSView {
        let container = NSView()
        container.translatesAutoresizingMaskIntoConstraints = false
        container.wantsLayer = true
        container.layer?.cornerRadius = 18
        container.layer?.borderWidth = 1
        container.layer?.borderColor = NSColor.white.withAlphaComponent(0.06).cgColor
        container.layer?.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 0.36).cgColor

        let dot = NSView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 3.5
        dot.layer?.backgroundColor = stateColor(item.state).cgColor

        let title = label(item.displayName, size: 17, color: NSColor.labelColor.withAlphaComponent(0.96), weight: .semibold)
        title.lineBreakMode = .byTruncatingTail

        let summary = label(item.summary, size: 12, color: NSColor.secondaryLabelColor.withAlphaComponent(0.94), weight: .regular)
        summary.lineBreakMode = .byWordWrapping
        summary.maximumNumberOfLines = presentation.summaryMaxLines

        let arrow = NSImageView(image: NSImage(
            systemSymbolName: "arrow.up.forward.app",
            accessibilityDescription: "Open session"
        ) ?? NSImage())
        arrow.translatesAutoresizingMaskIntoConstraints = false
        arrow.contentTintColor = NSColor.tertiaryLabelColor.withAlphaComponent(0.92)
        arrow.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 13, weight: .medium)

        let dismissButton = subtleIconButton(
            systemName: "xmark",
            description: "Dismiss",
            action: #selector(dismissSession(_:)),
            sessionId: item.sessionId
        )

        let topRow = NSStackView(views: [dot, title, spacer(), arrow, dismissButton])
        topRow.orientation = .horizontal
        topRow.alignment = .centerY
        topRow.spacing = 10
        topRow.translatesAutoresizingMaskIntoConstraints = false

        let bodyStack = NSStackView()
        bodyStack.orientation = .vertical
        bodyStack.alignment = .leading
        bodyStack.spacing = presentation.summaryVisible ? 7 : 0
        bodyStack.translatesAutoresizingMaskIntoConstraints = false
        bodyStack.addArrangedSubview(topRow)
        if presentation.summaryVisible {
            bodyStack.addArrangedSubview(summary)
        }

        let button = NSButton(title: "", target: self, action: #selector(openSession(_:)))
        button.isBordered = false
        button.bezelStyle = .shadowlessSquare
        button.identifier = NSUserInterfaceItemIdentifier(item.sessionId)
        button.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(button)
        container.addSubview(bodyStack)
        NSLayoutConstraint.activate([
            container.widthAnchor.constraint(equalToConstant: CGFloat(presentation.width) - 32),
            dot.widthAnchor.constraint(equalToConstant: 7),
            dot.heightAnchor.constraint(equalToConstant: 7),
            arrow.widthAnchor.constraint(equalToConstant: 14),
            arrow.heightAnchor.constraint(equalToConstant: 14),
            bodyStack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
            bodyStack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
            bodyStack.topAnchor.constraint(equalTo: container.topAnchor, constant: 14),
            bodyStack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -14),
            button.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            button.topAnchor.constraint(equalTo: container.topAnchor),
            button.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])

        return container
    }

    private func layoutPanel() {
        let rowHeight: CGFloat = presentation.summaryVisible ? 92 : 60
        let visibleRows = min(max(items.count, 1), max(presentation.maxVisibleRows, 1))
        let height = 58 + (CGFloat(visibleRows) * rowHeight) + 24
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

    @objc private func openSession(_ sender: NSButton) {
        guard
            let sessionId = sender.identifier?.rawValue,
            let item = items[sessionId]
        else {
            return
        }
        launch(item.focusCommand)
        items.removeValue(forKey: sessionId)
        refresh()
        panel.orderOut(nil)
    }

    @objc private func dismissSession(_ sender: NSButton) {
        guard let sessionId = sender.identifier?.rawValue else {
            return
        }
        items.removeValue(forKey: sessionId)
        refresh()
    }

    private func launch(_ command: FocusCommand) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: command.executable)
        process.arguments = command.args
        try? process.run()
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
        button.image = NSImage(
            systemSymbolName: systemName,
            accessibilityDescription: description
        )
        button.contentTintColor = NSColor.tertiaryLabelColor.withAlphaComponent(0.9)
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

let app = NSApplication.shared
let delegate = OverlayApp()
app.delegate = delegate
app.run()
