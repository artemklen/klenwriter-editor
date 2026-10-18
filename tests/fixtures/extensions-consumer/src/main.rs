// SPDX-License-Identifier: MIT OR Apache-2.0
//! One request and one JSON response per line; original nested JSON remains text.
use std::io::{self, BufRead, Write};

use editor_extension_external_consumer::{ConsumerSession, manifest, resource_counts};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Manifest {},
    Resources {},
    Open { input: String, options_json: String },
    Initialization {},
    Context {},
    Call { request_json: String },
    OwnResources {},
    Destroy {},
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut session: Option<ConsumerSession> = None;
    let mut output = io::BufWriter::new(io::stdout().lock());
    for line in io::stdin().lock().lines() {
        let request: Request = serde_json::from_str(&line?)?;
        let response = match request {
            Request::Manifest {} => serde_json::to_string(&manifest())?,
            Request::Resources {} => serde_json::to_string(&resource_counts())?,
            Request::Open {
                input,
                options_json,
            } => {
                if let Some(previous) = &mut session {
                    previous.destroy();
                }
                let next = ConsumerSession::new(input.as_bytes(), &options_json);
                let response = serde_json::to_string(&next.initialization())?;
                session = Some(next);
                response
            }
            Request::Initialization {} => {
                serde_json::to_string(&session.as_ref().ok_or("no open session")?.initialization())?
            }
            Request::Context {} => {
                serde_json::to_string(&session.as_ref().ok_or("no open session")?.context())?
            }
            Request::Call { request_json } => session
                .as_mut()
                .ok_or("no open session")?
                .call_json(&request_json),
            Request::OwnResources {} => serde_json::to_string(
                &session
                    .as_ref()
                    .ok_or("no open session")?
                    .own_resource_counts(),
            )?,
            Request::Destroy {} => {
                session.as_mut().ok_or("no open session")?.destroy();
                serde_json::to_string(&resource_counts())?
            }
        };
        writeln!(output, "{response}")?;
        output.flush()?;
    }
    if let Some(session) = &mut session {
        session.destroy();
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("external consumer harness: {error}");
        std::process::exit(1);
    }
}
