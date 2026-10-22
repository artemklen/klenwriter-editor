// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed installed clipboard fixture transport. No launch, focus, pointer or permission requests.
import Foundation
import AppKit
import ApplicationServices

typealias Fields = [String: Any]
let started = DispatchTime.now().uptimeNanoseconds
let absent = NSNull()
let formatLimit = 2 * 1024 * 1024
let aggregateLimit = 4 * 1024 * 1024
func elapsed() -> Double { Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000 }
func closed(_ value: Fields, _ keys: Set<String>) -> Bool { Set(value.keys) == keys }
func number(_ value: Any?) -> Double? {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
    return n.doubleValue
}
func boolean(_ value: Any?) -> Bool? {
    guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
    return n.boolValue
}
func whole(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) == (value.startIndex..<value.endIndex)
}
func frame(_ value: Any?) -> CGRect? {
    guard let f = value as? Fields, closed(f, ["x", "y", "width", "height"]),
          let x = number(f["x"]), let y = number(f["y"]), let w = number(f["width"]), let h = number(f["height"]),
          w > 0, h > 0, (x + w).isFinite, (y + h).isFinite else { return nil }
    return CGRect(x: x, y: y, width: w, height: h)
}
func encoded(_ r: CGRect) -> Fields { ["x": r.minX, "y": r.minY, "width": r.width, "height": r.height] }
func emit(_ value: Fields, _ code: Int32) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
    exit(code)
}
func invalid(_ reason: String) -> Never {
    emit(["format": "osr47-clipboard-platform-result/1", "status": "refused", "delivery": "not_sent",
          "reason": reason, "elapsedMs": elapsed()], 2)
}
struct Request {
    let json: Fields
    let operation: String
    let browser: String
    let title: String
    let pid: pid_t?
    let rootFrame: CGRect?
    let deadline: Double
    var expectedName: String { browser == "chrome" ? "Google Chrome" : "Safari" }
    var expectedBundle: String { browser == "chrome" ? "com.google.Chrome" : "com.apple.Safari" }
    var axTitle: String { title + (browser == "chrome" ? " - Google Chrome" : "") }
    var echo: Fields {
        var result = json
        result.removeValue(forKey: "plain")
        result.removeValue(forKey: "html")
        return result
    }
}
func parse(_ d: Fields) -> Request? {
    let common: Set<String> = ["format", "operation", "browser", "nonce", "title", "requestId", "deadlineMs"]
    guard d["format"] as? String == "osr47-clipboard-platform/1",
          let operation = d["operation"] as? String,
          ["inspect", "key", "clipboard-read", "clipboard-write"].contains(operation),
          let browser = d["browser"] as? String, ["chrome", "safari"].contains(browser),
          let nonce = d["nonce"] as? String, nonce.utf8.count == 32, whole(nonce, "^[a-f0-9]{32}$"),
          let title = d["title"] as? String, title == "KlenWriter Clipboard native " + nonce,
          let id = d["requestId"] as? String, whole(id, "^" + nonce + ":[1-9][0-9]{0,3}$"),
          let deadline = number(d["deadlineMs"]), deadline >= 1, deadline.rounded() == deadline,
          deadline <= (operation.hasPrefix("clipboard-") ? 2000 : 1000) else { return nil }
    if operation == "inspect" {
        guard closed(d, common) else { return nil }
        return Request(json: d, operation: operation, browser: browser, title: title, pid: nil, rootFrame: nil, deadline: deadline)
    }
    var keys = common.union(["pid", "rootFrame"])
    if operation == "key" { keys.formUnion(["action", "cleanupOnly"]) }
    if operation == "clipboard-write" { keys.formUnion(["plain", "html"]) }
    guard closed(d, keys), let pid = number(d["pid"]), pid >= 1, pid <= Double(Int32.max), pid.rounded() == pid,
          let root = frame(d["rootFrame"]) else { return nil }
    if operation == "key" {
        guard let action = d["action"] as? String, ["copy", "cut", "paste", "undo", "redo"].contains(action),
              boolean(d["cleanupOnly"]) != nil else { return nil }
    }
    if operation == "clipboard-write" {
        var total = 0, count = 0
        for name in ["plain", "html"] {
            if d[name] is NSNull { continue }
            guard let text = d[name] as? String, text.utf8.count <= formatLimit else { return nil }
            total += text.utf8.count
            count += 1
        }
        guard count > 0, total <= aggregateLimit else { return nil }
    }
    return Request(json: d, operation: operation, browser: browser, title: title, pid: pid_t(pid), rootFrame: root, deadline: deadline)
}
func attribute(_ e: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, name, &value) == .success ? value : nil
}
func axTitle(_ e: AXUIElement) -> String? { attribute(e, kAXTitleAttribute as CFString) as? String }
func rectangle(_ e: AXUIElement) -> CGRect? {
    guard let p = attribute(e, kAXPositionAttribute as CFString), CFGetTypeID(p) == AXValueGetTypeID(),
          let s = attribute(e, kAXSizeAttribute as CFString), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size),
          point.x.isFinite, point.y.isFinite, size.width.isFinite, size.height.isFinite,
          size.width > 0, size.height > 0, (point.x + size.width).isFinite, (point.y + size.height).isFinite else { return nil }
    return CGRect(origin: point, size: size)
}
enum Refusal: Error {
    case reason(String)
    var text: String { switch self { case .reason(let s): return s } }
}
struct Owner {
    let window: AXUIElement
    let pid: pid_t
    let frame: CGRect
    let proof: Fields
}
func checkDeadline(_ r: Request) throws {
    guard elapsed() < r.deadline else { throw Refusal.reason("Original operation deadline expired") }
}
func measure(_ r: Request, _ original: Owner? = nil) throws -> Owner {
    try checkDeadline(r)
    guard AXIsProcessTrusted() else { throw Refusal.reason("Existing Accessibility permission unavailable") }
    guard let front = NSWorkspace.shared.frontmostApplication,
          front.localizedName == r.expectedName, front.bundleIdentifier == r.expectedBundle,
          r.pid == nil || front.processIdentifier == r.pid else { throw Refusal.reason("Exact fixture browser is not frontmost") }
    let pid = front.processIdentifier
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.1)
    guard let windows = attribute(app, kAXWindowsAttribute as CFString) as? [AXUIElement],
          windows.count >= 1, windows.count <= 32 else { throw Refusal.reason("Bounded fixture window list unavailable") }
    let matches = windows.filter { axTitle($0) == r.axTitle }
    guard matches.count == 1, let root = matches.first,
          original == nil || (original!.pid == pid && CFEqual(root, original!.window)),
          attribute(root, kAXRoleAttribute as CFString) as? String == "AXWindow",
          attribute(root, kAXSubroleAttribute as CFString) as? String == "AXStandardWindow",
          let rootFrame = rectangle(root), r.rootFrame == nil || rootFrame == r.rootFrame,
          original == nil || rootFrame == original!.frame,
          let focused = attribute(app, kAXFocusedWindowAttribute as CFString), CFGetTypeID(focused) == AXUIElementGetTypeID(), CFEqual(focused, root) else {
        throw Refusal.reason("Unique nonce fixture, original frame or focused CF window differs")
    }
    guard let latest = NSWorkspace.shared.frontmostApplication, latest.processIdentifier == pid,
          latest.localizedName == r.expectedName, latest.bundleIdentifier == r.expectedBundle,
          let finalFocus = attribute(app, kAXFocusedWindowAttribute as CFString),
          CFGetTypeID(finalFocus) == AXUIElementGetTypeID(), CFEqual(finalFocus, root),
          axTitle(root) == r.axTitle, rectangle(root) == rootFrame else { throw Refusal.reason("Fixture ownership changed during measurement") }
    try checkDeadline(r)
    return Owner(window: root, pid: pid, frame: rootFrame, proof: ["pid": Int(pid), "name": r.expectedName,
        "bundle": r.expectedBundle, "title": r.axTitle, "role": "AXWindow", "subrole": "AXStandardWindow",
        "rootFrame": encoded(rootFrame), "windowCount": windows.count, "matchCount": 1, "focused": true])
}
struct Step {
    let code: CGKeyCode
    let down: Bool
    let flags: CGEventFlags
    let flagName: String
    var json: Fields { ["keyCode": Int(code), "down": down, "flags": flagName] }
}
func safariReleaseFirst(_ r: Request) -> Bool {
    r.browser == "safari" && ["copy", "cut", "paste", "undo"].contains(r.json["action"] as! String)
}
func program(_ r: Request) -> [Step] {
    let action = r.json["action"] as! String
    let code: CGKeyCode = ["copy": 8, "cut": 7, "paste": 9, "undo": 6, "redo": 6][action]!
    func step(_ key: CGKeyCode, _ down: Bool, _ name: String) -> Step {
        Step(code: key, down: down,
             flags: name == "command+shift" ? CGEventFlags.maskCommand.union(.maskShift) : (name == "command" ? .maskCommand : []), flagName: name)
    }
    if boolean(r.json["cleanupOnly"])! {
        return [step(55, false, "none")] + (action == "redo" ? [step(56, false, "none")] : []) + [step(code, false, "none")]
    }
    if action == "redo" {
        return [step(55, true, "command"), step(56, true, "command+shift"), step(code, true, "command+shift"),
                step(code, false, "command+shift"), step(56, false, "command"), step(55, false, "none")]
    }
    if safariReleaseFirst(r) {
        return [step(55, true, "command"), step(code, true, "command"), step(55, false, "none"), step(code, false, "none")]
    }
    return [step(55, true, "command"), step(code, true, "command"), step(code, false, "command"), step(55, false, "none")]
}
func base(_ r: Request, _ status: String, _ delivery: String) -> Fields {
    ["format": "osr47-clipboard-platform-result/1", "request": r.echo,
     "status": status, "delivery": delivery, "elapsedMs": elapsed()]
}
func keys(_ r: Request) -> Never {
    let steps = program(r)
    var posted: [Fields] = [], proofs: [Fields] = []
    var complete = false, postcondition: Fields = ["status": "not_attempted", "proof": absent]
    var reason: Any = absent
    do {
        let owner = try measure(r)
        guard CGPreflightPostEventAccess() else { throw Refusal.reason("Existing CG post-event access unavailable") }
        guard let source = CGEventSource(stateID: .privateState) else { throw Refusal.reason("Private CG event source unavailable") }
        let events = try steps.map { step -> CGEvent in
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: step.code, keyDown: step.down) else { throw Refusal.reason("Fixed CG program allocation failed") }
            event.flags = step.flags
            return event
        }
        for (index, event) in events.enumerated() {
            let proof = try measure(r, owner)
            try checkDeadline(r)
            event.post(tap: .cghidEventTap)
            posted.append(steps[index].json)
            proofs.append(proof.proof)
        }
        complete = true
        do { postcondition = ["status": "verified", "proof": try measure(r, owner).proof] }
        catch { postcondition = ["status": "refused", "proof": absent]; reason = (error as? Refusal)?.text ?? "Final ownership read failed" }
    } catch { reason = (error as? Refusal)?.text ?? "Fixed key program failed" }
    var result = base(r, complete ? "completed" : (posted.isEmpty ? "refused" : "unknown"), complete ? "posted" : (posted.isEmpty ? "not_sent" : "unknown/may_have_sent"))
    result["method"] = "CGEvent/cghidEventTap"
    result["programId"] = "osr47/" + (boolean(r.json["cleanupOnly"])! ? "release-" : "") + (r.json["action"] as! String) + (safariReleaseFirst(r) ? "/safari-release-first/1" : "/1")
    result["program"] = steps.map { $0.json }
    result["postedTransitions"] = posted
    result["postedCount"] = posted.count
    result["proofs"] = proofs
    result["postcondition"] = postcondition
    result["reason"] = reason
    emit(result, complete ? 0 : 2)
}
let selectedTypes: [(String, NSPasteboard.PasteboardType)] = [("plain", .string), ("html", .html)]
func readFormats(_ board: NSPasteboard) throws -> Fields {
    var result: Fields = [:], total = 0
    for (name, type) in selectedTypes {
        guard let data = board.data(forType: type) else { result[name] = absent; continue }
        total += data.count
        guard data.count <= formatLimit, total <= aggregateLimit else { throw Refusal.reason("Selected clipboard bytes exceed closed limit") }
        guard let text = String(data: data, encoding: .utf8), Data(text.utf8) == data else { throw Refusal.reason("Selected clipboard format is not exact UTF-8") }
        result[name] = ["type": type.rawValue, "bytes": data.count, "utf8Base64": data.base64EncodedString(), "text": text]
    }
    return result
}
func clipboard(_ r: Request) -> Never {
    var delivery = "not_sent", cleared = false
    var result = base(r, "refused", delivery)
    do {
        let owner = try measure(r)
        let board = NSPasteboard.general
        let before = board.changeCount
        result["changeCountBefore"] = before
        if r.operation == "clipboard-write" {
            let item = NSPasteboardItem()
            for (name, type) in selectedTypes {
                if let text = r.json[name] as? String {
                    guard item.setData(Data(text.utf8), forType: type) else { throw Refusal.reason("Preparing literal clipboard item failed") }
                }
            }
            _ = try measure(r, owner)
            try checkDeadline(r)
            board.clearContents()
            cleared = true
            delivery = "clipboard_may_have_changed"
            guard board.writeObjects([item]) else { throw Refusal.reason("Writing literal clipboard item failed after clear") }
            delivery = "clipboard_written"
        }
        try checkDeadline(r)
        let readStart = board.changeCount
        let formats = try readFormats(board)
        let after = board.changeCount
        guard readStart == after else { throw Refusal.reason("Clipboard changed during selected-format read") }
        let final = try measure(r, owner)
        result = base(r, "completed", r.operation == "clipboard-read" ? "not_sent" : delivery)
        result["changeCountBefore"] = before
        result["changeCountRead"] = readStart
        result["changeCountAfter"] = after
        result["formats"] = formats
        result["proof"] = final.proof
        result["cleared"] = cleared
        result["reason"] = absent
        emit(result, 0)
    } catch {
        result["delivery"] = delivery
        result["cleared"] = cleared
        result["elapsedMs"] = elapsed()
        result["reason"] = (error as? Refusal)?.text ?? "Clipboard operation failed"
        emit(result, 2)
    }
}

guard CommandLine.arguments.count == 1 else { invalid("No command-line action or arbitrary argument is accepted") }
var input = Data()
while true {
    let chunk = FileHandle.standardInput.readData(ofLength: 64 * 1024)
    if chunk.isEmpty { break }
    guard input.count + chunk.count <= 32 * 1024 * 1024 else { invalid("Closed request byte limit exceeded") }
    input.append(chunk)
}
guard let json = try? JSONSerialization.jsonObject(with: input) as? Fields, let request = parse(json) else { invalid("Invalid closed request") }
if request.operation == "key" { keys(request) }
if request.operation.hasPrefix("clipboard-") { clipboard(request) }
do {
    let first = try measure(request)
    let final = try measure(request, first)
    var result = base(request, "completed", "not_sent")
    result["proof"] = final.proof
    emit(result, 0)
} catch {
    var result = base(request, "refused", "not_sent")
    result["reason"] = (error as? Refusal)?.text ?? "Fixture inspection failed"
    emit(result, 2)
}
