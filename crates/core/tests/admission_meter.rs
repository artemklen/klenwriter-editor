// SPDX-License-Identifier: MIT OR Apache-2.0
use klenwriter_editor_core::transaction::{WorkLimits, WorkMeter};

#[test]
fn admission_cache_ceiling_is_separate_bounded_and_keeps_nested_accounting() {
    let unlimited = WorkLimits {
        units: u64::MAX,
        bytes: u64::MAX,
    };
    let ordinary = WorkMeter::new(unlimited);
    assert_eq!(
        ordinary.limits(),
        WorkLimits {
            units: 1_000_000,
            bytes: 64 * 1024 * 1024
        }
    );
    let mut admission = WorkMeter::for_admission_cache(unlimited);
    assert_eq!(
        admission.limits(),
        WorkLimits {
            units: 4_000_000,
            bytes: 128 * 1024 * 1024
        }
    );
    admission.charge_units(1_000_001).unwrap();
    admission.charge_bytes(64 * 1024 * 1024 + 1).unwrap();
    admission.with_budget(WorkLimits { units: 1, bytes: 1 }, |work| {
        work.charge_units(1).unwrap();
        work.charge_bytes(1).unwrap();
        assert!(work.charge_units(1).is_err());
        assert!(work.charge_bytes(1).is_err());
    });
    assert_eq!(
        admission.limits(),
        WorkLimits {
            units: 4_000_000,
            bytes: 128 * 1024 * 1024
        }
    );
    assert_eq!(admission.usage().units, 1_000_002);
    assert_eq!(admission.usage().bytes, 64 * 1024 * 1024 + 2);
    assert!(admission.charge_units(4_000_000).is_err());
    assert!(admission.charge_bytes(128 * 1024 * 1024).is_err());
    let mut tiny = WorkMeter::for_admission_cache(WorkLimits { units: 0, bytes: 0 });
    assert!(tiny.charge_units(1).is_err());
    assert!(tiny.charge_bytes(1).is_err());
    assert_eq!(tiny.usage().units, 0);
    assert_eq!(tiny.usage().bytes, 0);
}
