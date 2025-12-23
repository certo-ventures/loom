/**
 * Real TLS Notary Verification using Rust WASM
 * 
 * This implements cryptographic verification of TLS Notary presentations
 * using the official tlsn-core Rust library compiled to WASM.
 */

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use tlsn_core::presentation::Presentation;
use sha2::{Sha256, Digest};

/// Initialize the WASM module
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Verification result returned to JavaScript
#[derive(Debug, Serialize)]
pub struct VerificationResult {
    pub valid: bool,
    pub server_name: String,
    pub time: u64,
    pub data: serde_json::Value,
    pub proof_hash: String,
    pub notary_pubkey: String,
    pub redacted_ranges: Option<Vec<(usize, usize)>>,
    pub error: Option<String>,
}

/// Verify a TLS Notary presentation
/// 
/// This performs full cryptographic verification:
/// - Notary signature validation
/// - Certificate chain verification
/// - Merkle proof validation
/// - Transcript commitment verification
/// 
/// # Arguments
/// * `presentation_json` - JSON string containing TLS Notary presentation
/// 
/// # Returns
/// JSON string with verification result
#[wasm_bindgen]
pub fn verify_presentation(presentation_json: &str) -> Result<String, JsValue> {
    // Parse presentation
    let presentation: Presentation = serde_json::from_str(presentation_json)
        .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;
    
    // Create crypto provider for verification
    let provider = tlsn_core::CryptoProvider::default();
    
    // Perform cryptographic verification
    match presentation.verify(&provider) {
        Ok(output) => {
            // Extract HTTP data from verified transcript
            let data = parse_http_response(&output.recv_transcript);
            
            // Calculate proof hash
            let proof_hash = calculate_hash(presentation_json);
            
            // Build success result
            let result = VerificationResult {
                valid: true,
                server_name: output.server_name,
                time: output.time,
                data,
                proof_hash,
                notary_pubkey: hex::encode(&output.notary_pubkey),
                redacted_ranges: Some(output.redacted_ranges),
                error: None,
            };
            
            serde_json::to_string(&result)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
        }
        Err(e) => {
            // Build error result
            let result = VerificationResult {
                valid: false,
                server_name: String::new(),
                time: 0,
                data: serde_json::Value::Null,
                proof_hash: String::new(),
                notary_pubkey: String::new(),
                redacted_ranges: None,
                error: Some(format!("Verification failed: {}", e)),
            };
            
            serde_json::to_string(&result)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
        }
    }
}

/// Parse HTTP response from transcript
fn parse_http_response(transcript: &[u8]) -> serde_json::Value {
    // Convert to string
    let text = match String::from_utf8(transcript.to_vec()) {
        Ok(s) => s,
        Err(_) => return serde_json::json!({ "raw": hex::encode(transcript) })
    };
    
    // Try to find HTTP response body
    if let Some(body_start) = text.find("\r\n\r\n") {
        let body = &text[body_start + 4..];
        
        // Try to parse as JSON
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
            return json;
        }
        
        // Return as string if not JSON
        return serde_json::json!({ "text": body });
    }
    
    // Return full transcript if can't parse
    serde_json::json!({ "text": text })
}

/// Calculate SHA-256 hash of presentation
fn calculate_hash(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_proof_parsing() {
        let proof_json = r#"{
            "session_header": {
                "server_name": "api.example.com",
                "handshake_hash": [1, 2, 3, 4]
            },
            "transcript_proof": {
                "sent": [72, 69, 76, 76, 79],
                "received": [72, 73],
                "ranges": [{"start": 0, "end": 2}]
            },
            "signature": [5, 6, 7, 8]
        }"#;
        
        let result = verify_tls_notary_proof(proof_json);
        assert!(result.is_ok());
    }
}
