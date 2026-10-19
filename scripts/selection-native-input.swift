// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed selection fixture input. No arbitrary app, URL, keys, eval or screen coordinates.
import Foundation
import AppKit
import ApplicationServices

let began = DispatchTime.now().uptimeNanoseconds
var posted = false
func elapsed() -> Double { Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000 }
func emit(_ value: [String: Any], _ code: Int32) -> Never {
    let bytes = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(bytes); FileHandle.standardOutput.write(Data([10])); exit(code)
}
func refuse(_ reason: String) -> Never {
    emit(["status": "refused", "reason": reason, "delivery": posted ? "unknown/may_have_sent" : "not_sent", "elapsedMs": elapsed()], 2)
}
func closed(_ value: [String: Any], _ keys: Set<String>) -> Bool { Set(value.keys) == keys }
func number(_ value: Any?) -> Double? {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
    return n.doubleValue
}
func boolean(_ value: Any?) -> Bool? {
    guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
    return n.boolValue
}
func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
}
func title(_ element: AXUIElement) -> String? { attribute(element, kAXTitleAttribute as CFString) as? String }
func rectangle(_ element: AXUIElement) -> CGRect? {
    guard let p = attribute(element, kAXPositionAttribute as CFString), CFGetTypeID(p) == AXValueGetTypeID(),
          let s = attribute(element, kAXSizeAttribute as CFString), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var origin = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &origin), AXValueGetValue(s as! AXValue, .cgSize, &size),
          origin.x.isFinite, origin.y.isFinite, size.width.isFinite, size.height.isFinite,
          size.width > 0, size.height > 0 else { return nil }
    return CGRect(origin: origin, size: size)
}
func webViewport(_ window: AXUIElement) -> CGRect? {
    var todo: [(AXUIElement, Int)] = [(window, 0)], seen: [AXUIElement] = [], matches: [CGRect] = []
    while let (element, depth) = todo.popLast() {
        if seen.contains(where: { CFEqual($0, element) }) { continue }
        guard seen.count < 512, depth <= 32 else { return nil }; seen.append(element)
        if attribute(element, kAXRoleAttribute as CFString) as? String == "AXWebArea",
           let r = rectangle(element), abs(r.width - 1024) <= 0.5, abs(r.height - 768) <= 0.5 { matches.append(r) }
        if let children = attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
            guard children.count <= 512 - seen.count - todo.count else { return nil }
            for child in children.reversed() { todo.append((child, depth + 1)) }
        }
    }
    return matches.count == 1 ? matches[0] : nil
}
let argv = CommandLine.arguments
guard argv.count == 3, argv[1] == "--request", let data = argv[2].data(using: .utf8), data.count <= 4096,
      let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      closed(request, ["format", "browser", "nonce", "title", "fixtureUrl", "mountedId", "requestId", "serial", "caseId", "action", "target", "point", "viewport", "pointerDown", "cleanupOnly", "deadlineMs"]),
      request["format"] as? String == "osr40-native-input/1",
      let browser = request["browser"] as? String, ["chrome", "safari"].contains(browser),
      let nonce = request["nonce"] as? String, nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
      let expectedTitle = request["title"] as? String, expectedTitle == "KlenWriter Selection native " + nonce,
      request["fixtureUrl"] as? String == "http://127.0.0.1:4174/selection",
      let mount = request["mountedId"] as? String, mount.range(of: "^selection-mount-[1-9][0-9]{0,8}$", options: .regularExpression) != nil,
      let requestId = request["requestId"] as? String, requestId.range(of: "^" + nonce + ":[1-9][0-9]{0,3}$", options: .regularExpression) != nil,
      let serial = number(request["serial"]), serial >= 1, serial <= 1024, serial.rounded() == serial,
      let action = request["action"] as? String,
      ["move-start", "down", "move-end", "up", "shift-left", "select-all", "copy", "cut", "shift-tab", "tab"].contains(action),
      let caseId = request["caseId"] as? String,
      ["key-comb", "key-zwj", "key-flag", "key-rtl", "key-select-all", "mouse-forward", "mouse-reverse", "scroll-down-terminal", "scroll-up-terminal", "scroll-down-active", "scroll-up-active", "scroll-down-focus", "scroll-up-focus"].contains(caseId),
      let target = request["target"] as? String,
      let held = boolean(request["pointerDown"]), let cleanup = boolean(request["cleanupOnly"]),
      let deadline = number(request["deadlineMs"]), deadline >= 1, deadline <= 1000,
      let viewport = request["viewport"] as? [String: Any], closed(viewport, ["width", "height", "scale", "offsetLeft", "offsetTop"]),
      number(viewport["width"]) == 1024, number(viewport["height"]) == 768, number(viewport["scale"]) == 1,
      number(viewport["offsetLeft"]) == 0, number(viewport["offsetTop"]) == 0 else { refuse("Invalid closed selection request") }
guard target == (action == "tab" ? "host-control" : "editor") || action == "up" && held && target == "host-control",
      !cleanup || action == "up" && held else { refuse("Target or cleanup transition differs") }
let mouse = ["move-start", "down", "move-end", "up"].contains(action)
var point: CGPoint?
if mouse {
    guard let value = request["point"] as? [String: Any], closed(value, ["x", "y"]),
          let x = number(value["x"]), let y = number(value["y"]), x >= 0, x < 1024, y >= 0, y < 768 else { refuse("Invalid fixed client point") }
    point = CGPoint(x: x, y: y)
} else if !(request["point"] is NSNull) { refuse("Key cannot carry screen coordinates") }
guard action != "down" || !held, action != "move-start" || !held,
      action != "move-end" || held, action != "up" || held,
      mouse || action == "shift-tab" || !held else { refuse("Pointer transition differs") }
guard AXIsProcessTrusted() else { refuse("Existing Accessibility permission is unavailable") }
let expectedBundle = browser == "safari" ? "com.apple.Safari" : "com.google.Chrome"
let expectedAxWindowTitle = expectedTitle + (browser == "chrome" ? " - Google Chrome" : "")
guard let front = NSWorkspace.shared.frontmostApplication, front.bundleIdentifier == expectedBundle else { refuse("Fixture browser is not frontmost") }
let application = AXUIElementCreateApplication(front.processIdentifier)
guard let windows = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement], windows.count <= 32 else { refuse("Bounded browser AX windows unavailable") }
let matching = windows.filter { title($0) == expectedAxWindowTitle }
guard matching.count == 1, let focusedValue = attribute(application, kAXFocusedWindowAttribute as CFString),
      CFGetTypeID(focusedValue) == AXUIElementGetTypeID(), CFEqual(focusedValue, matching[0]) else { refuse("Exact unique fixture title is not focused") }
guard let view = webViewport(matching[0]), let frame = rectangle(matching[0]),
      view.minX >= frame.minX - 0.5, view.maxX <= frame.maxX + 0.5,
      view.minY >= frame.minY - 0.5, view.maxY <= frame.maxY + 0.5 else { refuse("Unique frozen AXWebArea viewport unavailable") }
guard elapsed() < deadline,
      NSWorkspace.shared.frontmostApplication?.processIdentifier == front.processIdentifier,
      let currentFocusedWindow = attribute(application, kAXFocusedWindowAttribute as CFString),
      CFGetTypeID(currentFocusedWindow) == AXUIElementGetTypeID(), CFEqual(currentFocusedWindow, matching[0]),
      let observedAxWindowTitle = title(matching[0]),
      observedAxWindowTitle == expectedAxWindowTitle else { refuse("Fixture guard expired or ownership changed before post") }
var global: CGPoint?
if let local = point {
    let actual = CGPoint(x: view.minX + local.x, y: view.minY + local.y); global = actual
    let type: CGEventType = action == "down" ? .leftMouseDown : action == "up" ? .leftMouseUp : action == "move-end" ? .leftMouseDragged : .mouseMoved
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: actual, mouseButton: .left) else { refuse("Cannot allocate fixture mouse event") }
    if action == "down" || action == "up" { event.setIntegerValueField(.mouseEventClickState, value: 1) }
    posted = true; event.post(tap: .cghidEventTap)
} else {
    let code: CGKeyCode = action == "shift-left" ? 123 : action == "select-all" ? 0 : action == "copy" ? 8 : action == "cut" ? 7 : 48
    let flags: CGEventFlags = ["shift-left", "shift-tab"].contains(action) ? .maskShift : ["select-all", "copy", "cut"].contains(action) ? .maskCommand : []
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else { refuse("Cannot allocate fixture modified-key pair") }
    down.flags = flags; up.flags = flags
    posted = true; down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
}
guard elapsed() <= deadline else { refuse("Fixture guard expired during post") }
var result: [String: Any] = ["status": "sent", "action": action, "nonce": nonce, "requestId": requestId,
    "mountedId": mount, "caseId": caseId, "target": target, "cleanupOnly": cleanup,
    "frontBundle": expectedBundle, "frontPid": front.processIdentifier,
    "expectedAxWindowTitle": expectedAxWindowTitle, "observedAxWindowTitle": observedAxWindowTitle,
    "axWindowCount": windows.count, "axViewport": ["x": view.minX, "y": view.minY, "width": view.width, "height": view.height],
    "elapsedMs": elapsed(), "method": "fixture-scoped CGEvent; platform input, not hardware-device provenance"]
if let global { result["screenPoint"] = ["x": global.x, "y": global.y] }
emit(result, 0)
