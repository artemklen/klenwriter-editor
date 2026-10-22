// SPDX-License-Identifier: MIT OR Apache-2.0
// Finite typography fixture keys; inspect only the original focused AX window.
import Foundation
import AppKit
import ApplicationServices

let started = DispatchTime.now().uptimeNanoseconds
func elapsed() -> Double { Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000 }
var posted: [[String: Any]] = []
func emit(_ value: [String: Any], _ code: Int32) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])); exit(code)
}
func refuse(_ reason: String) -> Never {
    emit(["status": posted.isEmpty ? "refused" : "unknown", "delivery": posted.isEmpty ? "not_sent" : "unknown/may_have_sent",
          "reason": reason, "posted": posted, "elapsedMs": elapsed()], 2)
}
func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
}
func frame(_ element: AXUIElement) -> [String: Double]? {
    guard let p = attribute(element, kAXPositionAttribute as CFString), CFGetTypeID(p) == AXValueGetTypeID(),
          let s = attribute(element, kAXSizeAttribute as CFString), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var origin = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &origin), AXValueGetValue(s as! AXValue, .cgSize, &size),
          origin.x.isFinite, origin.y.isFinite, size.width.isFinite, size.height.isFinite,
          size.width > 0, size.height > 0 else { return nil }
    return ["x": origin.x, "y": origin.y, "width": size.width, "height": size.height]
}
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count <= 4096, let request = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
      Set(request.keys) == Set(["format", "operation", "browser", "nonce", "title", "action", "owner", "deadlineMs"]),
      request["format"] as? String == "osr48-typography-keys/1",
      let operation = request["operation"] as? String, ["inspect", "key", "release"].contains(operation),
      let browser = request["browser"] as? String, ["chrome", "safari"].contains(browser),
      let nonce = request["nonce"] as? String, nonce.utf8.count == 32,
      nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
      let title = request["title"] as? String, title == "KlenWriter Typography native " + nonce,
      let action = request["action"] as? String,
      let deadline = request["deadlineMs"] as? NSNumber, CFGetTypeID(deadline) != CFBooleanGetTypeID(),
      deadline.doubleValue.isFinite, deadline.doubleValue >= 1, deadline.doubleValue <= 1000 else { refuse("Closed fixture request required") }
let keys: [String: UInt16] = ["quote-en":39, "quote-ru":19, "space":49, "ru-letter":3,
                             "backspace":51, "undo":6, "redo":6, "dead-e":14, "letter-e":14]
guard operation == "inspect" ? action.isEmpty : keys[action] != nil else { refuse("Unknown fixed key") }
let expectedBundle = browser == "chrome" ? "com.google.Chrome" : "com.apple.Safari"
let expectedTitle = title + (browser == "chrome" ? " - Google Chrome" : "")
guard AXIsProcessTrusted() else { refuse("Existing Accessibility permission unavailable") }
guard let front = NSWorkspace.shared.frontmostApplication, front.bundleIdentifier == expectedBundle else { refuse("Fixture browser is not frontmost") }
let app = AXUIElementCreateApplication(front.processIdentifier)
guard let windows = attribute(app, kAXWindowsAttribute as CFString) as? [AXUIElement], windows.count <= 32 else { refuse("Bounded fixture windows unavailable") }
let matches = windows.filter { attribute($0, kAXTitleAttribute as CFString) as? String == expectedTitle }
guard matches.count == 1, let window = matches.first, let originalFrame = frame(window) else { refuse("Unique exact fixture window unavailable") }
let owner: [String: Any] = ["pid": front.processIdentifier, "frame": originalFrame]
if operation != "inspect" {
    guard let expected = request["owner"] as? [String: Any], Set(expected.keys) == Set(["pid", "frame"]),
          let pid = expected["pid"] as? NSNumber, CFGetTypeID(pid) != CFBooleanGetTypeID(), pid.int32Value == front.processIdentifier,
          let rectangle = expected["frame"] as? [String: Double], rectangle == originalFrame else { refuse("Original owned fixture changed") }
} else if !(request["owner"] is NSNull) { refuse("Inspection cannot rebind an owner") }
func check() {
    guard elapsed() < deadline.doubleValue,
          NSWorkspace.shared.frontmostApplication?.processIdentifier == front.processIdentifier,
          attribute(window, kAXTitleAttribute as CFString) as? String == expectedTitle,
          frame(window) == originalFrame,
          let focused = attribute(app, kAXFocusedWindowAttribute as CFString), CFGetTypeID(focused) == AXUIElementGetTypeID(),
          CFEqual(focused, window) else { refuse("Original focus or deadline changed") }
}
check()
if operation == "inspect" {
    emit(["status":"completed", "delivery":"not_sent", "owner":owner, "bundle":expectedBundle,
          "title":expectedTitle, "posted":posted, "elapsedMs":elapsed()], 0)
}
struct Step { let key: UInt16; let down: Bool; let flags: CGEventFlags; let name: String }
let key = keys[action]!
var program: [Step] = []
func step(_ key: UInt16, _ down: Bool, _ flags: CGEventFlags = [], _ name: String = "none") -> Step { Step(key:key,down:down,flags:flags,name:name) }
let shift = action == "quote-en" || action == "quote-ru" || action == "redo"
let command = action == "undo" || action == "redo"
let option = action == "dead-e"
if operation == "release" {
    program = [step(55,false), step(56,false), step(58,false), step(key,false)]
} else if command && shift {
    program = [step(55,true,.maskCommand,"command"), step(56,true,[.maskCommand,.maskShift],"command+shift"),
        step(key,true,[.maskCommand,.maskShift],"command+shift")]
    program += browser == "safari"
        ? [step(56,false,.maskCommand,"command"),step(55,false),step(key,false)]
        : [step(key,false,[.maskCommand,.maskShift],"command+shift"),step(56,false,.maskCommand,"command"),step(55,false)]
} else if command {
    program = [step(55,true,.maskCommand,"command"),step(key,true,.maskCommand,"command")]
    program += browser == "safari" ? [step(55,false),step(key,false)] : [step(key,false,.maskCommand,"command"),step(55,false)]
} else if shift {
    program = [step(56,true,.maskShift,"shift"),step(key,true,.maskShift,"shift"),step(key,false,.maskShift,"shift"),step(56,false)]
} else if option {
    program = [step(58,true,.maskAlternate,"option"),step(key,true,.maskAlternate,"option"),step(key,false,.maskAlternate,"option"),step(58,false)]
} else { program = [step(key,true),step(key,false)] }
guard let source = CGEventSource(stateID:.hidSystemState) else { refuse("Key event source unavailable") }
for item in program {
    check()
    guard let event = CGEvent(keyboardEventSource:source,virtualKey:item.key,keyDown:item.down) else { refuse("Key allocation unavailable") }
    event.flags = item.flags
    event.post(tap:.cghidEventTap)
    posted.append(["keyCode":Int(item.key),"down":item.down,"flags":item.name])
    usleep(12000)
}
check()
emit(["status":"completed","delivery":"posted","owner":owner,"bundle":expectedBundle,
      "title":expectedTitle,"posted":posted,"elapsedMs":elapsed()],0)
