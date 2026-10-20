// SPDX-License-Identifier: MIT OR Apache-2.0
// UI42 CG02: closed Chrome Find programs; no arbitrary application or key input.
import Foundation
import AppKit
import ApplicationServices

let began = DispatchTime.now().uptimeNanoseconds
func elapsed() -> Double { Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000 }
typealias Fields = [String: Any]
let null = NSNull()
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
    guard let d = value as? Fields, closed(d, ["x", "y", "width", "height"]),
          let x = number(d["x"]), let y = number(d["y"]),
          let w = number(d["width"]), let h = number(d["height"]),
          w > 0, h > 0, (x + w).isFinite, (y + h).isFinite else { return nil }
    return CGRect(x: x, y: y, width: w, height: h)
}
func encoded(_ r: CGRect) -> Fields { ["x": r.minX, "y": r.minY, "width": r.width, "height": r.height] }
struct Step {
    let key: CGKeyCode
    let down: Bool
    let command: Bool
    var json: Fields { ["keyCode": Int(key), "down": down, "flags": command ? "command" : "none"] }
}
struct Request {
    let json: Fields
    let title: String
    let pid: pid_t
    let frame: CGRect
    let deadline: Double
    let action: String
    let cleanup: Bool
    var programId: String { (cleanup ? "release-" : "") + action }
    var desired: String { cleanup ? "either" : (action == "find" ? "open" : "closed") }
    var program: [Step] {
        switch programId {
        case "find": return [Step(key: 55, down: true, command: true), Step(key: 3, down: true, command: true), Step(key: 3, down: false, command: true), Step(key: 55, down: false, command: false)]
        case "close-find": return [Step(key: 53, down: true, command: false), Step(key: 53, down: false, command: false)]
        case "release-find": return [Step(key: 55, down: false, command: false), Step(key: 3, down: false, command: false)]
        default: return [Step(key: 53, down: false, command: false)]
        }
    }
    var core: Fields {
        let transitions: [String]
        switch programId {
        case "find": transitions = ["command-down", "key3-down", "key3-up", "command-up"]
        case "close-find": transitions = ["key53-down", "key53-up"]
        case "release-find": transitions = ["command-up", "key3-up"]
        default: transitions = ["key53-up"]
        }
        return ["status": cleanup ? "keys-released" : "key-sent", "action": programId,
                "keyCode": action == "find" ? 3 : 53, "modifiers": action == "find" ? ["command"] : [],
                "keyTransitions": transitions, "frontPid": Int(pid)]
    }
}
func parse(_ d: Fields) -> Request? {
    guard closed(d, ["format", "browser", "nonce", "title", "fixtureUrl", "mountedId", "caseId", "findRequestId", "requestId", "serial", "pid", "rootFrame", "purpose", "deadlineMs", "action", "cleanupOnly"]),
          d["format"] as? String == "osr42-chrome-find-key/1", d["browser"] as? String == "chrome",
          d["purpose"] as? String == "key", d["caseId"] as? String == "modes-zoom",
          d["fixtureUrl"] as? String == "http://127.0.0.1:4174/ui",
          let nonce = d["nonce"] as? String, nonce.utf8.count == 32, whole(nonce, "^[a-f0-9]{32}$"),
          let title = d["title"] as? String, title == "KlenWriter UI native " + nonce,
          let mount = d["mountedId"] as? String, whole(mount, "^ui42-[1-9][0-9]{0,8}$"),
          let findId = d["findRequestId"] as? String, whole(findId, "^" + nonce + ":[1-9][0-9]{0,3}$"),
          let id = d["requestId"] as? String, whole(id, "^" + nonce + ":[1-9][0-9]{0,3}$"),
          let serial = number(d["serial"]), serial >= 1, serial <= 2048, serial.rounded() == serial,
          let pid = number(d["pid"]), pid >= 1, pid <= Double(Int32.max), pid.rounded() == pid,
          let f = frame(d["rootFrame"]), let ms = number(d["deadlineMs"]), ms >= 1, ms <= 1000, ms.rounded() == ms,
          let action = d["action"] as? String, action == "find" || action == "close-find",
          let cleanup = boolean(d["cleanupOnly"]),
          (action == "find" && !cleanup ? id == findId : id != findId) else { return nil }
    return Request(json: d, title: title, pid: pid_t(pid), frame: f, deadline: ms, action: action, cleanup: cleanup)
}
func diagnostic(_ code: String, _ reason: String) -> Fields { ["code": code, "reason": reason] }
func emit(_ request: Request?, _ echo: Any, _ posted: [Fields], _ proofs: [Fields],
          _ postcondition: Fields, _ problem: Fields?, _ complete: Bool) -> Never {
    let result: Fields = [
        "format": "osr42-chrome-find-key-result/1", "status": complete ? "completed" : (posted.isEmpty ? "refused" : "unknown"),
        "delivery": complete ? "sent" : (posted.isEmpty ? "not_sent" : "unknown/may_have_sent"),
        "method": "CGEvent/cghidEventTap", "request": echo, "programId": request?.programId as Any? ?? null,
        "program": request?.program.map { $0.json } as Any? ?? null, "postedTransitions": posted,
        "postedCount": posted.count, "preflightProofs": proofs, "core": complete ? (request?.core as Any? ?? null) : null,
        "postcondition": postcondition, "diagnostic": problem as Any? ?? null, "elapsedMs": elapsed()
    ]
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
    exit(complete ? 0 : 2)
}
func notAttempted(_ request: Request?) -> Fields {
    ["status": "not_attempted", "expectedPhase": request?.desired as Any? ?? null, "observedPhase": null,
     "reads": 0, "proof": null, "diagnostic": null]
}
func attribute(_ e: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, name, &result) == .success ? result : nil
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
struct Measurement {
    let root: AXUIElement
    let phase: String
    let json: Fields
}
enum MeasurementFailure: Error {
    case expired
    case refused(String)
    var json: Fields {
        switch self {
        case .expired: return diagnostic("deadline", "Original Find-key deadline expired")
        case .refused(let reason): return diagnostic("ownership", reason)
        }
    }
}
func measure(_ r: Request, _ originalRoot: AXUIElement?) throws -> Measurement {
    guard elapsed() < r.deadline else { throw MeasurementFailure.expired }
    guard AXIsProcessTrusted() else { throw MeasurementFailure.refused("Existing Accessibility permission unavailable") }
    guard let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier == r.pid,
          front.localizedName == "Google Chrome", front.bundleIdentifier == "com.google.Chrome" else {
        throw MeasurementFailure.refused("Original Chrome process is not frontmost")
    }
    let app = AXUIElementCreateApplication(r.pid)
    guard let windows = attribute(app, kAXWindowsAttribute as CFString) as? [AXUIElement], windows.count == 1 || windows.count == 2 else {
        throw MeasurementFailure.refused("Closed Chrome Find window count differs")
    }
    let rootTitle = r.title + " - Google Chrome"
    let roots = windows.filter { axTitle($0) == rootTitle }
    guard roots.count == 1, let root = roots.first,
          originalRoot == nil || CFEqual(root, originalRoot!),
          attribute(root, kAXRoleAttribute as CFString) as? String == "AXWindow",
          attribute(root, kAXSubroleAttribute as CFString) as? String == "AXStandardWindow",
          let rootFrame = rectangle(root), rootFrame == r.frame,
          let focused = attribute(app, kAXFocusedWindowAttribute as CFString), CFGetTypeID(focused) == AXUIElementGetTypeID(), CFEqual(focused, root) else {
        throw MeasurementFailure.refused("Original nonce root, role, frame or focused object differs")
    }
    var aux: Any = null
    let phase = windows.count == 2 ? "open" : "closed"
    if phase == "open" {
        let others = windows.filter { !CFEqual($0, root) }
        let auxTitle = "Find in page\n    " + r.title
        guard others.count == 1, let other = others.first, axTitle(other) == auxTitle,
              attribute(other, kAXRoleAttribute as CFString) as? String == "AXWindow",
              attribute(other, kAXSubroleAttribute as CFString) as? String == "AXUnknown",
              let f = rectangle(other), f.minX >= rootFrame.minX, f.maxX <= rootFrame.maxX,
              f.minY >= rootFrame.minY, f.maxY <= rootFrame.maxY else {
            throw MeasurementFailure.refused("Exact contained nonce Find auxiliary differs")
        }
        aux = ["title": auxTitle, "role": "AXWindow", "subrole": "AXUnknown", "frame": encoded(f)] as Fields
    }
    // Final same-owner read remains fresh after all finite window attributes.
    guard let latest = NSWorkspace.shared.frontmostApplication, latest.processIdentifier == r.pid,
          latest.localizedName == "Google Chrome", latest.bundleIdentifier == "com.google.Chrome",
          let fresh = attribute(app, kAXFocusedWindowAttribute as CFString), CFGetTypeID(fresh) == AXUIElementGetTypeID(), CFEqual(fresh, root),
          axTitle(root) == rootTitle, rectangle(root) == r.frame else {
        throw MeasurementFailure.refused("Original Chrome ownership changed during measurement")
    }
    guard elapsed() < r.deadline else { throw MeasurementFailure.expired }
    return Measurement(root: root, phase: phase, json: ["frontPid": Int(r.pid), "frontName": "Google Chrome",
        "frontBundle": "com.google.Chrome", "rootTitle": rootTitle, "rootRole": "AXWindow", "rootSubrole": "AXStandardWindow",
        "rootFrame": encoded(rootFrame), "rootFocused": true, "phase": phase, "windowCount": windows.count, "findAux": aux, "contained": true])
}

// Closed validation precedes AX queries and every CG allocation, including source.
var echo: Any = null
if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--request",
   let bytes = CommandLine.arguments[2].data(using: .utf8), bytes.count <= 4096,
   let value = try? JSONSerialization.jsonObject(with: bytes) as? Fields { echo = value }
guard let fields = echo as? Fields, let request = parse(fields) else {
    emit(nil, echo, [], [], notAttempted(nil), diagnostic("request", "Invalid closed request"), false)
}
if elapsed() >= request.deadline {
    emit(request, fields, [], [], notAttempted(request), diagnostic("deadline", "Original Find-key deadline expired"), false)
}
guard let source = CGEventSource(stateID: .privateState) else {
    emit(request, fields, [], [], notAttempted(request), diagnostic("allocation", "Private CG event source unavailable"), false)
}
let program = request.program
var events: [CGEvent] = []
for step in program {
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: step.key, keyDown: step.down) else {
        emit(request, fields, [], [], notAttempted(request), diagnostic("allocation", "Closed CG event allocation failed"), false)
    }
    event.flags = step.command ? .maskCommand : []
    events.append(event)
}
var posted: [Fields] = [], proofs: [Fields] = []
var originalRoot: AXUIElement?
for (index, event) in events.enumerated() {
    do {
        let measurement = try measure(request, originalRoot)
        if index == 0 {
            let required = request.cleanup ? "either" : (request.action == "find" ? "closed" : "open")
            guard required == "either" || measurement.phase == required else {
                emit(request, fields, posted, proofs, notAttempted(request), diagnostic("phase", "Initial closed Find phase differs"), false)
            }
            originalRoot = measurement.root
        }
        guard elapsed() < request.deadline else { throw MeasurementFailure.expired }
        event.post(tap: .cghidEventTap)
        posted.append(program[index].json)
        proofs.append(measurement.json)
    } catch let failure as MeasurementFailure {
        emit(request, fields, posted, proofs, notAttempted(request), failure.json, false)
    } catch {
        emit(request, fields, posted, proofs, notAttempted(request), diagnostic("measurement", "Closed Find measurement unavailable"), false)
    }
}
// All posts returned. Preserve complete core even if final phase/time is refused.
var reads = 0
var last: Measurement?
var postStatus = "unobserved"
var postProblem: Fields? = diagnostic("phase", "Required Find phase was not observed within the original budget")
while reads < 12 && elapsed() < request.deadline {
    reads += 1
    do {
        let measurement = try measure(request, originalRoot)
        last = measurement
        if request.desired == "either" || measurement.phase == request.desired {
            postStatus = "verified"
            postProblem = nil
            break
        }
        let remaining = request.deadline - elapsed()
        if reads < 12 && remaining > 0 { Thread.sleep(forTimeInterval: min(4, remaining) / 1000) }
    } catch let failure as MeasurementFailure {
        switch failure {
        case .expired: break
        case .refused: postStatus = "refused"; last = nil
        }
        postProblem = failure.json
        break
    } catch {
        postStatus = "refused"
        last = nil
        postProblem = diagnostic("measurement", "Closed Find measurement unavailable")
        break
    }
}
let postcondition: Fields = ["status": postStatus, "expectedPhase": request.desired,
    "observedPhase": last?.phase as Any? ?? null, "reads": reads, "proof": last?.json as Any? ?? null,
    "diagnostic": postProblem as Any? ?? null]
emit(request, fields, posted, proofs, postcondition, nil, true)
