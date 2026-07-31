use std::{fmt::Display, panic, sync::LazyLock};

use regex::Regex;

const REDACTED: &str = "[REDACTED]";
const REDACTED_PRIVATE_KEY: &str = "[REDACTED PRIVATE KEY]";

static PRIVATE_KEY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?is)-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----.*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----",
    )
    .expect("private-key redaction pattern must compile")
});
static URL_USERINFO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b([a-z][a-z0-9+.-]*://)[^\s/]+@").expect("URL redaction pattern must compile")
});
static SECRET_VALUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)(["']?(?:password|passphrase|private[_-]?key|client[_-]?key|token|secret|access[_-]?token|api[_-]?key)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}]+)"#,
    )
    .expect("secret-value redaction pattern must compile")
});
static AUTHORIZATION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(\b(?:authorization|proxy-authorization)\b\s*[:=]\s*(?:bearer|basic)\s+)[^\s,;&]+",
    )
    .expect("authorization redaction pattern must compile")
});

pub fn redact(value: &str) -> String {
    let value = PRIVATE_KEY.replace_all(value, REDACTED_PRIVATE_KEY);
    let value = URL_USERINFO.replace_all(&value, format!("${{1}}{REDACTED}@"));
    let value = SECRET_VALUE.replace_all(&value, format!("${{1}}{REDACTED}"));
    AUTHORIZATION
        .replace_all(&value, format!("${{1}}{REDACTED}"))
        .into_owned()
}

pub fn report_error(context: &str, error: &impl Display) {
    eprintln!("{context}: {}", redact(&error.to_string()));
}

pub fn install_panic_hook() {
    panic::set_hook(Box::new(|info| {
        if let Some(location) = info.location() {
            eprintln!(
                "Plume terminated unexpectedly at {}:{}:{}; panic details were suppressed.",
                location.file(),
                location.line(),
                location.column()
            );
        } else {
            eprintln!("Plume terminated unexpectedly; panic details were suppressed.");
        }
    }));
}

#[cfg(test)]
mod tests {
    use super::{REDACTED, REDACTED_PRIVATE_KEY, redact};

    #[test]
    fn redacts_connection_urls_and_secret_fields() {
        let secret = "sentinel-db-password";
        let input = format!(
            "connect postgresql://alice:{secret}@part@db.internal:5432/plume?sslmode=require \
             password={secret} passphrase: '{secret}' \
             JSON={{\"api_key\":\"{secret}\",\"token\":\"{secret}\"}} \
             Authorization: Bearer {secret}"
        );

        let redacted = redact(&input);

        assert!(!redacted.contains(secret));
        assert!(redacted.contains(&format!("postgresql://{REDACTED}@db.internal")));
        assert!(redacted.contains(&format!("password={REDACTED}")));
        assert!(redacted.contains(&format!("Authorization: Bearer {REDACTED}")));
        assert!(redacted.contains("db.internal:5432/plume"));
    }

    #[test]
    fn redacts_pem_and_escaped_private_key_blocks() {
        let private_key = "-----BEGIN OPENSSH PRIVATE KEY-----\nsentinel-key-material\n-----END OPENSSH PRIVATE KEY-----";
        let escaped_private_key = private_key.replace('\n', "\\n");

        for input in [private_key.to_owned(), escaped_private_key] {
            let redacted = redact(&format!("key={input}; host=db.internal"));
            assert!(!redacted.contains("sentinel-key-material"));
            assert!(redacted.contains(REDACTED_PRIVATE_KEY));
            assert!(redacted.contains("host=db.internal"));
        }
    }

    #[test]
    fn redaction_is_idempotent_and_preserves_safe_context() {
        let input = "TLS handshake with db.internal failed: password=hunter2";
        let once = redact(input);

        assert_eq!(redact(&once), once);
        assert_eq!(
            once,
            "TLS handshake with db.internal failed: password=[REDACTED]"
        );
    }
}
