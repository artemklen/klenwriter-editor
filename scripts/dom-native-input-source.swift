// SPDX-License-Identifier: MIT OR Apache-2.0
// Enumerates/selects existing macOS keyboard input sources; changes no preferences.
import Foundation
import Carbon

func property(_ source: TISInputSource, _ key: CFString) -> UnsafeMutableRawPointer? {
    return TISGetInputSourceProperty(source, key)
}
func string(_ source: TISInputSource, _ key: CFString) -> String? {
    guard let value = property(source, key) else { return nil }
    return Unmanaged<CFString>.fromOpaque(value).takeUnretainedValue() as String
}
func flag(_ source: TISInputSource, _ key: CFString) -> Bool {
    guard let value = property(source, key) else { return false }
    return CFBooleanGetValue(Unmanaged<CFBoolean>.fromOpaque(value).takeUnretainedValue())
}
func describe(_ source: TISInputSource) -> [String: Any] {
    return ["id": string(source, kTISPropertyInputSourceID) ?? "",
        "name": string(source, kTISPropertyLocalizedName) ?? "",
        "type": string(source, kTISPropertyInputSourceType) ?? "",
        "selected": flag(source, kTISPropertyInputSourceIsSelected),
        "enabled": flag(source, kTISPropertyInputSourceIsEnabled),
        "selectable": flag(source, kTISPropertyInputSourceIsSelectCapable)]
}
func emit(_ value: [String: Any], _ code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])); exit(code)
}
let action = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "status"
let sources = TISCreateInputSourceList(nil, false).takeRetainedValue() as! [TISInputSource]
if action == "status" {
    emit(["status": "ok", "current": describe(TISCopyCurrentKeyboardInputSource().takeRetainedValue()),
        "sources": sources.map(describe)])
}
if action == "select" && CommandLine.arguments.count == 3 {
    let requested = CommandLine.arguments[2]
    guard let source = sources.first(where: {string($0,kTISPropertyInputSourceID) == requested && flag($0,kTISPropertyInputSourceIsEnabled) && flag($0,kTISPropertyInputSourceIsSelectCapable)}) else {
        emit(["status": "not_run", "reason": "Existing enabled/selectable input source is unavailable", "requested": requested], 2)
    }
    let result = TISSelectInputSource(source)
    emit(["status": result == noErr ? "ok" : "not_run", "osStatus": result,
        "requested": requested, "current": describe(TISCopyCurrentKeyboardInputSource().takeRetainedValue())], result == noErr ? 0 : 3)
}
emit(["status": "not_run", "reason": "Usage: input-source status | select EXISTING_ID"], 2)
