ALTER TABLE users
    ADD COLUMN subscription_current_period_end date;

ALTER TABLE magic_link_tokens
    ADD COLUMN purpose text NOT NULL DEFAULT 'login',
    ADD COLUMN pending_email text;

ALTER TABLE magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_purpose_check CHECK (
        purpose IN ('login', 'email_update')
    );
