//! Temporary performance calibration only. This is not the editor model or SDK ABI.
use std::cell::RefCell;

struct Node { parent: u32, kind: u32, text: String }
#[derive(Default)]
struct State { input: Vec<u8>, nodes: Vec<Node>, output: Vec<u8>, counter: u32 }
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }

#[no_mangle]
pub extern "C" fn prepare_input(length: u32) -> u32 {
    STATE.with(|s| { let mut s = s.borrow_mut(); s.input.resize(length as usize, 0); s.input.as_mut_ptr() as u32 })
}

fn u32_at(bytes: &[u8], cursor: &mut usize) -> Option<u32> {
    let end = cursor.checked_add(4)?;
    let value = u32::from_le_bytes(bytes.get(*cursor..end)?.try_into().ok()?);
    *cursor = end;
    Some(value)
}

#[no_mangle]
pub extern "C" fn load_document() -> u32 {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let mut cursor = 0;
        let Some(count) = u32_at(&s.input, &mut cursor) else { return 1 };
        // A malformed private calibration buffer must not trigger unbounded allocation.
        if count as usize > s.input.len() / 12 { return 2 }
        let mut nodes = Vec::with_capacity(count as usize);
        for i in 0..count {
            let (Some(parent), Some(kind), Some(length)) = (u32_at(&s.input, &mut cursor), u32_at(&s.input, &mut cursor), u32_at(&s.input, &mut cursor)) else { return 3 };
            if parent != u32::MAX && parent >= i { return 4 }
            let Some(end) = cursor.checked_add(length as usize) else { return 5 };
            let Some(bytes) = s.input.get(cursor..end) else { return 6 };
            let Ok(text) = String::from_utf8(bytes.to_vec()) else { return 7 };
            nodes.push(Node { parent, kind, text }); cursor = end;
        }
        if cursor != s.input.len() { return 8 }
        s.nodes = nodes;
        0
    })
}

#[no_mangle]
pub extern "C" fn crossing_counter(value: u32) -> u32 {
    STATE.with(|s| { let mut s = s.borrow_mut(); s.counter = s.counter.wrapping_add(value); s.counter })
}

#[no_mangle]
pub extern "C" fn edit_pair_batch(index: u32, iterations: u32) -> u32 {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let Some(node) = s.nodes.get_mut(index as usize) else { return 0 };
        let text = &mut node.text;
        let mut checksum = 0u32;
        for i in 0..iterations {
            let mut offset = text.len() / 2;
            while !text.is_char_boundary(offset) { offset -= 1; }
            let character = if i & 1 == 0 { 'x' } else { 'y' };
            text.insert(offset, character);
            checksum = checksum.wrapping_add(std::hint::black_box(text.as_bytes()[offset]) as u32);
            text.remove(offset);
        }
        checksum
    })
}

#[no_mangle]
pub extern "C" fn export_document() -> u32 {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let mut output = std::mem::take(&mut s.output);
        output.clear(); output.extend_from_slice(&(s.nodes.len() as u32).to_le_bytes());
        for node in &s.nodes {
            output.extend_from_slice(&node.parent.to_le_bytes());
            output.extend_from_slice(&node.kind.to_le_bytes());
            output.extend_from_slice(&(node.text.len() as u32).to_le_bytes());
            output.extend_from_slice(node.text.as_bytes());
        }
        let length = output.len() as u32; s.output = output; length
    })
}

#[no_mangle]
pub extern "C" fn output_pointer() -> u32 { STATE.with(|s| s.borrow().output.as_ptr() as u32) }

#[no_mangle]
pub extern "C" fn text_bytes() -> u32 { STATE.with(|s| s.borrow().nodes.iter().map(|n| n.text.len() as u32).sum()) }

#[no_mangle]
pub extern "C" fn node_count() -> u32 { STATE.with(|s| s.borrow().nodes.len() as u32) }
