// SPDX-License-Identifier: MIT OR Apache-2.0
#[cfg(feature = "allocator-profile")]
#[global_allocator]
static ALLOCATOR: dhat::Alloc = dhat::Alloc;
#[cfg(feature = "allocator-profile")]
mod support;
fn main() {
    #[cfg(feature = "allocator-profile")]
    {
        // Includes request decoding, corpus ownership and result construction.
        // One fresh process/one profiler; no all-time-peak subtraction.
        let profiler = dhat::Profiler::builder()
            .file_name("dhat-heap.json")
            .build();
        support::main(true);
        drop(profiler);
    }
    #[cfg(not(feature = "allocator-profile"))]
    panic!("native-allocator requires --features allocator-profile");
}
