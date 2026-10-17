//! Schema-independent resource accounting. Profiles own their normative maxima.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LimitExceeded {
    pub name: &'static str,
    pub maximum: u64,
    pub observed: u64,
}

pub fn check(name: &'static str, maximum: u64, observed: u64) -> Result<(), LimitExceeded> {
    if observed > maximum {
        Err(LimitExceeded {
            name,
            maximum,
            observed,
        })
    } else {
        Ok(())
    }
}

/// Host settings can only tighten the profile/distribution ceiling.
pub const fn effective(profile_maximum: u64, host_maximum: u64) -> u64 {
    if host_maximum < profile_maximum {
        host_maximum
    } else {
        profile_maximum
    }
}
