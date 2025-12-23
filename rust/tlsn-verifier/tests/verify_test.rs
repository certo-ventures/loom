use tlsn_verifier::{verify_tls_notary_proof, TlsNotaryProof};

#[test]
fn test_basic_verification() {
    let proof_json = r#"{
        "session_header": {
            "server_name": "api.bankofamerica.com",
            "handshake_hash": [1, 2, 3, 4, 5, 6, 7, 8]
        },
        "transcript_proof": {
            "sent": [],
            "received": [72, 101, 108, 108, 111],
            "ranges": [{"start": 0, "end": 5}]
        },
        "signature": [9, 10, 11, 12]
    }"#;
    
    let result = verify_tls_notary_proof(proof_json);
    assert!(result.is_ok());
    
    let verified_data = result.unwrap();
    assert!(verified_data.contains("api.bankofamerica.com"));
}

#[test]
fn test_invalid_json() {
    let invalid_json = "not valid json";
    let result = verify_tls_notary_proof(invalid_json);
    assert!(result.is_err());
}

#[test]
fn test_missing_fields() {
    let incomplete_json = r#"{
        "session_header": {
            "server_name": "test.com"
        }
    }"#;
    
    let result = verify_tls_notary_proof(incomplete_json);
    assert!(result.is_err());
}
