-- Each tag owns its prompt. Existing tags and older explicit-column inserts default to empty.
ALTER TABLE config_version_tags
 ADD COLUMN jev_prompt TEXT NOT NULL DEFAULT ('');
