from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ADDON_DIRECTORY = PROJECT_ROOT / "src-tauri" / "addons"
FIXTURE_DIRECTORY = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(ADDON_DIRECTORY))

from analyzers import analyze_request  # noqa: E402
from analyzers.classifier import classify_endpoint  # noqa: E402


def firebase_fixture() -> bytes:
    return bytes.fromhex(
        (FIXTURE_DIRECTORY / "firebase_native_batch.hex").read_text(encoding="ascii")
    )


class AnalyticsAnalyzerTests(unittest.TestCase):
    def test_native_firebase_batch_decodes_events_properties_items_and_consent(
        self,
    ) -> None:
        analysis = analyze_request(
            "https://sub.app-measurement.com/a?app_id=test",
            firebase_fixture(),
        )

        self.assertIsNotNone(analysis)
        self.assertEqual(analysis["providerId"], "firebase")
        self.assertEqual(analysis["serviceId"], "analytics")
        self.assertEqual(analysis["protocol"], "firebase-native-protobuf")
        self.assertEqual(analysis["status"], "decoded")
        self.assertEqual(analysis["parserVersion"], "1.0.0")
        self.assertEqual(analysis["platform"], "android")
        self.assertIsInstance(analysis["confidence"], float)

        bundle = analysis["bundles"][0]
        self.assertEqual(
            [event["name"] for event in bundle["events"]],
            ["view_item", "user_engagement"],
        )
        event = bundle["events"][0]
        self.assertEqual(event["timestampMs"], 1_750_000_000_123)
        self.assertEqual(event["parameters"]["_previousTimestampMs"], 1_749_999_999_000)
        self.assertEqual(event["origin"], "app")
        self.assertEqual(event["parameters"]["currency"], "VND")
        self.assertEqual(event["parameters"]["user_id"], "••••••••")
        self.assertEqual(event["items"][0]["item_id"], "59258")
        self.assertEqual(event["items"][0]["price"], 34_990_000.0)
        self.assertEqual(bundle["userProperties"]["ga_session_number"], 1)
        self.assertEqual(bundle["consent"]["ad_storage"], "granted")

    def test_firebase_native_exact_endpoint_does_not_match_lookalikes(self) -> None:
        self.assertIsNone(
            classify_endpoint("https://evilapp-measurement.com/a", firebase_fixture())
        )
        self.assertIsNone(
            classify_endpoint("https://app-measurement.com.evil.example/a", firebase_fixture())
        )
        self.assertIsNone(
            classify_endpoint("https://app-measurement.com/not-a", firebase_fixture())
        )

    def test_other_firebase_services_are_tagged_without_analytics_bundles(self) -> None:
        cases = {
            "https://firebaseappcheck.googleapis.com/v1/projects/p/apps/a:exchangeToken": (
                "app-check"
            ),
            "https://firebaseinstallations.googleapis.com/v1/projects/p/installations": (
                "installations"
            ),
            "https://firebasecrashlytics.googleapis.com/v1/projects/p/reports": (
                "crashlytics"
            ),
            "https://crashlyticsreports-pa.googleapis.com/v1/firelog/legacy/batchlog": (
                "logging"
            ),
        }

        for url, service_id in cases.items():
            with self.subTest(service_id=service_id):
                analysis = analyze_request(url, b"{}")
                self.assertIsNotNone(analysis)
                self.assertEqual(analysis["serviceId"], service_id)
                self.assertEqual(analysis["status"], "identified")
                self.assertEqual(analysis["bundles"], [])

    def test_malformed_and_unknown_native_protobuf_fail_safely(self) -> None:
        malformed = analyze_request(
            "https://app-measurement.com/a",
            firebase_fixture()[:-3],
            content_truncated=True,
        )
        self.assertEqual(malformed["status"], "error")
        self.assertTrue(any("truncated" in warning.lower() for warning in malformed["warnings"]))

        unknown_schema = analyze_request(
            "https://app-measurement.com/a",
            b"\x12\x00",
        )
        self.assertEqual(unknown_schema["status"], "unsupported")
        self.assertEqual(unknown_schema["bundles"], [])
        self.assertTrue(
            any("unsupported field" in warning for warning in unknown_schema["warnings"])
        )

    def test_measurement_protocol_json_is_decoded_and_redacted(self) -> None:
        payload = {
            "client_id": "sensitive-client",
            "timestamp_micros": 1_750_000_000_123_456,
            "user_properties": {
                "plan": {"value": "pro"},
                "user_id": {"value": "private-user"},
            },
            "consent": {"ad_user_data": "DENIED"},
            "events": [
                {
                    "name": "purchase",
                    "params": {
                        "currency": "VND",
                        "password": "private",
                        "items": [
                            {
                                "item_id": "sku-1",
                                "item_name": "Phone",
                                "email": "private@example.com",
                            }
                        ],
                    },
                }
            ],
        }
        analysis = analyze_request(
            "https://www.google-analytics.com/mp/collect"
            "?measurement_id=G-TEST&api_secret=private",
            json.dumps(payload).encode(),
        )

        self.assertIsNotNone(analysis)
        self.assertEqual(analysis["protocol"], "ga4-measurement-protocol")
        self.assertEqual(analysis["status"], "decoded")
        bundle = analysis["bundles"][0]
        self.assertEqual(bundle["measurementId"], "G-TEST")
        self.assertEqual(bundle["userProperties"]["plan"], "pro")
        self.assertEqual(bundle["userProperties"]["user_id"], "••••••••")
        self.assertEqual(bundle["consent"], {"ad_user_data": "DENIED"})
        event = bundle["events"][0]
        self.assertEqual(event["timestampMicros"], 1_750_000_000_123_456)
        self.assertEqual(event["parameters"]["password"], "••••••••")
        self.assertEqual(event["items"][0]["email"], "••••••••")

    def test_ga_newline_batch_expands_hits_and_products(self) -> None:
        body = (
            b"t=event&ea=view_item&ep.currency=VND&pr1=id59258~nmiPhone~pr34990000\n"
            b"t=event&ea=user_engagement&epn.engagement_time_msec=4389"
        )
        analysis = analyze_request(
            "https://www.google-analytics.com/batch?v=1&tid=UA-TEST",
            body,
        )

        self.assertIsNotNone(analysis)
        self.assertEqual(analysis["protocol"], "google-analytics-batch")
        self.assertEqual(analysis["status"], "decoded")
        bundle = analysis["bundles"][0]
        self.assertEqual(bundle["measurementId"], "UA-TEST")
        self.assertEqual(
            [event["name"] for event in bundle["events"]],
            ["view_item", "user_engagement"],
        )
        self.assertEqual(bundle["events"][0]["items"][0]["item_id"], "59258")
        self.assertEqual(bundle["events"][0]["items"][0]["price"], 34_990_000)
        self.assertEqual(
            bundle["events"][1]["parameters"]["engagement_time_msec"], 4389
        )

    def test_ga_query_and_form_hits_are_decoded(self) -> None:
        query_analysis = analyze_request(
            "https://region1.google-analytics.com/g/collect"
            "?v=2&tid=G-TEST&en=screen_view&ep.firebase_screen=Home&up.plan=pro",
            b"",
        )
        self.assertIsNotNone(query_analysis)
        query_bundle = query_analysis["bundles"][0]
        self.assertEqual(query_bundle["events"][0]["name"], "screen_view")
        self.assertEqual(
            query_bundle["events"][0]["parameters"]["firebase_screen"], "Home"
        )
        self.assertEqual(query_bundle["userProperties"]["plan"], "pro")

        form_analysis = analyze_request(
            "https://www.google-analytics.com/collect?v=1&tid=UA-TEST",
            b"t=event&ea=login&ec=account",
        )
        self.assertIsNotNone(form_analysis)
        form_event = form_analysis["bundles"][0]["events"][0]
        self.assertEqual(form_event["name"], "login")
        self.assertEqual(form_event["parameters"]["ec"], "account")

    def test_google_collect_requires_exact_host_path_and_markers(self) -> None:
        self.assertIsNone(
            analyze_request("https://api.example.com/collect?v=2&tid=G-TEST", b"")
        )
        self.assertIsNone(
            analyze_request("https://www.google-analytics.com/collect", b"hello=world")
        )
        self.assertIsNone(
            analyze_request("https://www.google-analytics.com/not-collect?v=2&tid=G-TEST", b"")
        )


if __name__ == "__main__":
    unittest.main()
