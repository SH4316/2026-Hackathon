-- Patterns are configuration text. Python syntax validation and execution belong to the detector.
ALTER TABLE config_version_tags
 ADD COLUMN python_regex TEXT NOT NULL DEFAULT ('');
