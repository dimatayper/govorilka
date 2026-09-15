# SPDX-License-Identifier: AGPL-3.0-or-later
import unittest
import numpy as np
from evaluate_egorp import measure


class AlignmentTests(unittest.TestCase):
    def test_known_delay_and_gain(self):
        clean = np.random.default_rng(5).normal(0, 0.1, 12000)
        output = np.concatenate((np.zeros(1920), clean * 0.5, np.zeros(100)))
        metrics = measure(clean, output)
        self.assertEqual(metrics['delay_samples'], 1920)
        self.assertAlmostEqual(metrics['speech_projection_gain_db'], -6.020599913, places=6)
        self.assertGreater(metrics['si_sdr_db'], 100)
        self.assertLess(metrics['unscaled_sdr_db'], 7)

    def test_noise_lowers_score(self):
        rng = np.random.default_rng(7)
        clean = rng.normal(0, 0.1, 12000)
        noisy = clean + rng.normal(0, 0.1, len(clean))
        self.assertLess(measure(clean, noisy)['si_sdr_db'], 1)

    def test_truncation_rejected(self):
        with self.assertRaises(ValueError):
            measure(np.ones(1000), np.ones(500))

    def test_silent_reference_rejected(self):
        with self.assertRaises(ValueError):
            measure(np.zeros(1000), np.zeros(1000))


if __name__ == '__main__':
    unittest.main()
