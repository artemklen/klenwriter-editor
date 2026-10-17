use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

struct Resolver(bool);
impl api::IdentityResolver for Resolver {
    fn resolve_media(&self, _: &Uuid) -> Result<api::IdentityStatus, api::IdentityResolverError> {
        Ok(if self.0 { api::IdentityStatus::Exists } else { api::IdentityStatus::Missing })
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<api::IdentityStatus, api::IdentityResolverError> {
        self.resolve_media(&Uuid::nil())
    }
}
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

pub fn run(input: &[u8], normalize: bool, identities: bool, project: bool) -> Value {
    let resolver = Resolver(identities);
    let result = if normalize { api::decode_normalize_validate(input, &resolver) }
        else { api::validate_normalized_json(input, &resolver) };
    match result {
        Err(e) => json!({"kind":"refused","code":e.code.as_str(),"path":e.path,
            "category":e.context.category,"limit":e.context.limit,"maximum":e.context.maximum,"observed":e.context.observed}),
        Ok(doc) => {
            let projection = if project {
                match std::panic::catch_unwind(|| doc.project_text()) {
                    Ok(p) => json!({"full":digest(p.full_text.as_bytes()),"search":digest(p.search_index_text.as_bytes()),"snippet":digest(p.public_snippet_text.as_bytes())}),
                    Err(_) => json!({"panicked":true}),
                }
            } else { json!({"skipped":"explicit probe budget"}) };
            json!({"kind":"admitted","canonical":digest(doc.canonical_json()),
                "events":doc.normalization_events().iter().map(|e| e.code()).collect::<Vec<_>>(),
                "media":doc.media_manifest().iter().map(|r|json!({"id":r.id,"path":r.path})).collect::<Vec<_>>(),
                "references":doc.reference_manifest().iter().map(|r|json!({"id":r.id,"path":r.path})).collect::<Vec<_>>(),
                "projections":projection})
        }
    }
}
