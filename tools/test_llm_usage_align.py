#!/usr/bin/env python3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import llm_usage_align as align


class AlignmentHelperTests(unittest.TestCase):
    def test_first_run_creates_tracker_directory_before_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            tracker_home = Path(directory) / 'tracker'
            lock_path = tracker_home / 'remote-align.lock'
            with patch.object(align, 'TRACKER_HOME', tracker_home), patch.object(align, 'LOCK_PATH', lock_path):
                align.acquire_lock(timeout=0.1)
                self.assertTrue(lock_path.is_dir())
                align.release_lock()
            self.assertFalse(lock_path.exists())

    def test_provider_filter_does_not_guess_from_model_name(self):
        self.assertTrue(align.is_ali_record({'provider': 'ali', 'model': 'qwen-max'}))
        self.assertFalse(align.is_ali_record({'provider': 'custom', 'model': 'qwen-max'}))
        self.assertFalse(align.is_ali_record({'provider': 'deepseek', 'model': 'deepseek-chat'}))


if __name__ == '__main__':
    unittest.main()
