-- Keep V9/V10 immutable and extend the dashboard's shared detector settings.
ALTER TABLE detector_settings ADD COLUMN policy_state_map JSON NULL;
UPDATE detector_settings SET policy_state_map=JSON_OBJECT('allow',NULL,'warn',NULL,'block',NULL);
ALTER TABLE detector_settings MODIFY COLUMN policy_state_map JSON NOT NULL;

-- Only replace the initial value; preserve an administrator's saved masked/off choice.
UPDATE detector_settings SET report_text='full' WHERE revision=0 AND updated_at IS NULL;
