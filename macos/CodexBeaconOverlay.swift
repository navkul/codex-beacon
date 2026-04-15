import AppKit
import Foundation

struct FocusCommand: Decodable {
    let executable: String
    let args: [String]
}

struct OverlayEvent: Decodable {
    let type: String
    let sessionId: String
    let displayName: String?
    let summary: String?
    let timestamp: String?
    let focusCommand: FocusCommand?
}

struct OverlayItem {
    let sessionId: String
    let displayName: String
    let summary: String
    let timestamp: String
    let focusCommand: FocusCommand
}

final class OverlayApp: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let panel = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 420, height: 220),
        styleMask: [.borderless, .nonactivatingPanel],
        backing: .buffered,
        defer: false
    )
    private let contentView = NSView()
    private let stackView = NSStackView()
    private var items: [String: OverlayItem] = [:]
    private let decoder = JSONDecoder()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureStatusItem()
        configurePanel()
        readEventsFromStdin()
    }

    private func configureStatusItem() {
        statusItem.button?.title = "Beacon"
        statusItem.button?.target = self
        statusItem.button?.action = #selector(toggleOverlay)
    }

    private func configurePanel() {
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        contentView.wantsLayer = true
        contentView.layer?.cornerRadius = 12
        contentView.layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.96).cgColor
        contentView.layer?.borderColor = NSColor.separatorColor.withAlphaComponent(0.45).cgColor
        contentView.layer?.borderWidth = 1

        stackView.orientation = .vertical
        stackView.alignment = .leading
        stackView.distribution = .fill
        stackView.spacing = 10
        stackView.translatesAutoresizingMaskIntoConstraints = false

        contentView.addSubview(stackView)
        NSLayoutConstraint.activate([
            stackView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 14),
            stackView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -14),
            stackView.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            stackView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12)
        ])

        panel.contentView = contentView
    }

    private func readEventsFromStdin() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8) else {
                    continue
                }
                do {
                    let event = try self?.decoder.decode(OverlayEvent.self, from: data)
                    if let event {
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
            summary: event.summary ?? "Codex is ready for your next prompt.",
            timestamp: event.timestamp ?? "",
            focusCommand: focusCommand
        )
        refresh()
        showOverlay()
    }

    private func refresh() {
        statusItem.button?.title = items.isEmpty ? "Beacon" : "Beacon \(items.count)"

        for child in stackView.arrangedSubviews {
            stackView.removeArrangedSubview(child)
            child.removeFromSuperview()
        }

        if items.isEmpty {
            stackView.addArrangedSubview(label("No waiting Codex sessions.", size: 13, color: .secondaryLabelColor))
            panel.orderOut(nil)
            return
        }

        stackView.addArrangedSubview(label("Codex Beacon", size: 13, color: .secondaryLabelColor, weight: .semibold))

        for item in items.values.sorted(by: { $0.displayName < $1.displayName }) {
            let row = makeRow(for: item)
            stackView.addArrangedSubview(row)
        }

        layoutPanel()
    }

    private func makeRow(for item: OverlayItem) -> NSView {
        let button = NSButton()
        button.bezelStyle = .regularSquare
        button.isBordered = false
        button.target = self
        button.action = #selector(openSession(_:))
        button.identifier = NSUserInterfaceItemIdentifier(item.sessionId)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.contentTintColor = .labelColor

        let container = NSView()
        container.wantsLayer = true
        container.layer?.cornerRadius = 8
        container.layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.72).cgColor
        container.translatesAutoresizingMaskIntoConstraints = false

        let title = label(item.displayName, size: 15, color: .labelColor, weight: .semibold)
        let summary = label(item.summary, size: 13, color: .secondaryLabelColor)
        summary.maximumNumberOfLines = 2

        let rowStack = NSStackView(views: [title, summary])
        rowStack.orientation = .vertical
        rowStack.alignment = .leading
        rowStack.spacing = 4
        rowStack.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(rowStack)
        container.addSubview(button)
        NSLayoutConstraint.activate([
            rowStack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
            rowStack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -12),
            rowStack.topAnchor.constraint(equalTo: container.topAnchor, constant: 10),
            rowStack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -10),
            button.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            button.topAnchor.constraint(equalTo: container.topAnchor),
            button.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            container.widthAnchor.constraint(equalToConstant: 392)
        ])
        return container
    }

    private func label(_ text: String, size: CGFloat, color: NSColor, weight: NSFont.Weight = .regular) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = NSFont.systemFont(ofSize: size, weight: weight)
        field.textColor = color
        field.lineBreakMode = .byTruncatingTail
        field.translatesAutoresizingMaskIntoConstraints = false
        return field
    }

    private func layoutPanel() {
        let rowHeight = CGFloat(max(1, items.count)) * 72
        let height = min(420, max(120, rowHeight + 48))
        let width: CGFloat = 420
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
    }

    private func launch(_ command: FocusCommand) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: command.executable)
        process.arguments = command.args
        try? process.run()
    }
}

let app = NSApplication.shared
let delegate = OverlayApp()
app.delegate = delegate
app.run()
