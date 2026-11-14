import json
import stat
import tempfile
import unittest
from pathlib import Path

from ardia_cli.browse import flowlog, flowrun, flows
from ardia_cli.browse import shape as shaping
from ardia_cli.browse.errors import BrowseError, Usage

SEARCH = {"query": "kettle", "results": [{"title": "Steel kettle", "price": 30, "seller": {"name": "Ana"}},
                                         {"title": "Glass kettle", "price": 45, "seller": {"name": "Bo"}}], "total": 2}


def request(url, value, method="GET", body=None, headers=None, kind="json", status=200):
    return {"method": method, "url": url, "type": "Fetch" if kind == "json" else "Document", "status": status, "mime": "application/json",
            "headers": headers or {}, "body": body, "strippedAuth": False, "kind": kind, "text": value if isinstance(value, str) else json.dumps(value),
            "bytes": len(value if isinstance(value, str) else json.dumps(value))}


def recorded(*steps):
    log = flowlog.Log()
    for step in steps:
        log.add(dict(step))
    return list(log.steps)


def search_steps(typed="kettle", secret=False):
    return recorded(
        {"command": ["open", "https://shop.example.com/search"], "replay": ["open", "https://shop.example.com/search"], "before": "",
         "url": "https://shop.example.com/search", "ok": True, "requests": [], "writes": []},
        {"command": ["fill", "#q", typed], "replay": ["fill", "#q", typed], "typed": {"value": typed, "index": 2, "field": "q", "secret": secret},
         "before": "https://shop.example.com/search", "url": "https://shop.example.com/search", "ok": True, "requests": [], "writes": []},
        {"command": ["click", "#go"], "replay": ["click", "#go"], "before": "https://shop.example.com/search",
         "url": "https://shop.example.com/search", "ok": True,
         "requests": [request(f"https://api.example.com/v1/search?q={typed}&page=1", SEARCH,
                              headers={"accept": "application/json"}),
                      request("https://cdn.other.net/x.json", {"a": 1})],
         "writes": []},
    )


class ShapeTest(unittest.TestCase):
    def test_main_list_is_the_heaviest_list_of_objects(self):
        body = {"meta": {"tags": [{"a": 1}]}, "data": {"items": [{"title": "x" * 40}, {"title": "y"}]}}
        self.assertEqual(shaping.main_list(body)[0], "data.items")
        self.assertEqual(shaping.main_list([{"a": 1}]), (None, [{"a": 1}]))
        self.assertIsNone(shaping.main_list({"a": [1, 2]}))

    def test_fields_where_limit(self):
        shape = shaping.parse_shape("title,seller.name", ["title=GLASS"], "5")
        self.assertEqual(shaping.apply(SEARCH, shape),
                         {"list": "results", "total": 2, "matched": 1, "items": [{"title": "Glass kettle", "seller.name": "Bo"}]})
        limited = shaping.apply(SEARCH, shaping.parse_shape(limit=1))
        self.assertEqual((limited["matched"], len(limited["items"])), (2, 1))

    def test_unknown_fields_fail_with_the_valid_ones(self):
        with self.assertRaises(BrowseError) as caught:
            shaping.apply(SEARCH, shaping.parse_shape("titel"))
        self.assertEqual(caught.exception.code, "unknown_field")
        self.assertEqual(caught.exception.data["fields"], ["title", "price", "seller.name"])
        self.assertIn("title, price, seller.name", caught.exception.message)

    def test_no_list(self):
        self.assertEqual(shaping.apply({"a": 1}, shaping.Shape()), {"a": 1})
        with self.assertRaises(BrowseError):
            shaping.apply({"a": 1}, shaping.parse_shape("a"))
        with self.assertRaises(Usage):
            shaping.parse_shape(where=["novalue"])
        with self.assertRaises(Usage):
            shaping.parse_shape(limit="lots")


class BuildTest(unittest.TestCase):
    def test_typed_value_becomes_a_param_without_a_recorded_copy(self):
        flow, report = flows.build_flow("search", search_steps())
        self.assertEqual(flow["params"], [{"name": "q", "example": None, "source": "typed"}])
        output = flows.output_request(flow)
        self.assertEqual(output["url"], "https://api.example.com/v1/search?q={{q}}&page=1")
        self.assertEqual(flow["steps"][1]["command"], ["fill", "#q", "{{q}}"])
        self.assertEqual(flow["site"], "example.com")
        self.assertEqual(flow["hosts"], ["api.example.com", "shop.example.com"])
        self.assertEqual(output["expect"]["list"], "results")
        self.assertEqual(output["expect"]["itemFields"], ["title", "price", "seller.name"])
        self.assertEqual([item["id"] for item in report["requests"]], ["s3r1"])
        self.assertNotIn("kettle", json.dumps(flow))
        self.assertTrue(flow["replayable"])

    def test_given_param_keeps_its_example_and_name(self):
        flow, _ = flows.build_flow("search", search_steps(), {"term": "kettle"})
        self.assertEqual(flow["params"], [{"name": "term", "example": "kettle", "source": "typed"}])
        self.assertIn("q={{term}}", flows.output_request(flow)["url"])

    def test_query_value_the_requests_sent_becomes_a_param(self):
        steps = recorded(
            {"command": ["open", "https://shop.example.com/s?q=toaster&utm_source=x&token=abc123"], "replay": ["open", "https://shop.example.com/s?q=toaster&utm_source=x&token=abc123"],
             "before": "", "url": "https://shop.example.com/s?q=toaster&utm_source=x&token=abc123", "ok": True,
             "requests": [request("https://shop.example.com/api?term=toaster", SEARCH)], "writes": []},
        )
        flow, _ = flows.build_flow("s", steps)
        self.assertEqual(flow["params"], [{"name": "q", "example": "toaster", "source": "query"}])
        self.assertEqual(flow["startUrl"], "https://shop.example.com/s?q={{q}}&utm_source=x&token=<redacted>")
        self.assertEqual(flow["redactedSteps"], [1])
        self.assertFalse(flow["replayable"])
        self.assertNotIn("abc123", json.dumps(flow))

    def test_secret_values_are_redacted_and_requests_carrying_them_dropped(self):
        steps = recorded(
            {"command": ["open", "https://bank.example.org/login"], "replay": ["open", "https://bank.example.org/login"], "before": "",
             "url": "https://bank.example.org/login", "ok": True, "requests": [], "writes": []},
            {"command": ["fill", "#pw", "hunter22"], "replay": ["fill", "#pw", "hunter22"], "typed": {"value": "hunter22", "index": 2, "secret": True},
             "before": "https://bank.example.org/login", "url": "https://bank.example.org/login", "ok": True,
             "requests": [request("https://bank.example.org/api/check?pw=hunter22", {"ok": True})], "writes": []},
            {"command": ["click", "#go"], "replay": ["click", "#go"], "before": "https://bank.example.org/login", "url": "https://bank.example.org/home",
             "ok": True, "requests": [request("https://bank.example.org/api/accounts", {"accounts": [{"id": 1}]},
                                              headers={"content-type": "application/json"})],
             "writes": [{"method": "POST", "url": "https://bank.example.org/api/session", "kind": "explicit", "status": 200}]},
        )
        flow, report = flows.build_flow("accounts", steps)
        text = json.dumps(flow)
        self.assertNotIn("hunter22", text)
        self.assertEqual(flow["steps"][1]["command"], ["fill", "#pw", "<redacted>"])
        self.assertEqual(flow["redactedSteps"], [2])
        self.assertEqual([item["id"] for item in report["dropped"]], ["s2r1"])
        self.assertEqual(flow["writes"], [{"id": "w1", "method": "POST", "url": "https://bank.example.org/api/session", "kind": "explicit", "step": 3}])
        self.assertEqual(flow["params"], [])

    def test_credential_headers_are_never_kept(self):
        headers, stripped = flowlog.kept_headers({"Authorization": "Bearer x", "Cookie": "a=b", "X-CSRF-Token": "t", "Accept": "application/json",
                                                  "Content-Type": "application/json", "X-Api-Key": "k"})
        self.assertEqual(headers, {"accept": "application/json", "content-type": "application/json"})
        self.assertTrue(stripped)

    def test_writes(self):
        self.assertEqual(flowlog.write_kind("POST", "https://a.com/api", "{}"), "explicit")
        self.assertIsNone(flowlog.write_kind("POST", "https://a.com/graphql", json.dumps({"query": "query Q { a }"})))
        self.assertEqual(flowlog.write_kind("POST", "https://a.com/graphql", json.dumps({"query": "mutation M { a }"})), "explicit")
        self.assertEqual(flowlog.write_kind("GET", "https://a.com/account/logout", None), "suspected")
        self.assertIsNone(flowlog.write_kind("GET", "https://a.com/address", None))

    def test_json_bodies_and_graphql_text(self):
        body = json.dumps({"query": "query Search($q: String) { search(q: $q) { id } } # kettle", "variables": {"q": "kettle"}})
        steps = search_steps()
        steps[2]["requests"] = [dict(request("https://shop.example.com/graphql", SEARCH, method="POST", body=body, headers={"content-type": "application/json"}), id="s3r1")]
        flow, _ = flows.build_flow("gql", steps)
        output = flows.output_request(flow)
        self.assertEqual(json.loads(output["body"]), {"query": "query Search($q: String) { search(q: $q) { id } } # kettle", "variables": {"q": "{{q}}"}})
        self.assertEqual(json.loads(flows.fill_body(output["body"], "json", {"q": 'a "b"'}))["variables"]["q"], 'a "b"')
        self.assertEqual(flow["writes"], [])

    def test_nothing_to_save(self):
        steps = search_steps()
        steps[2]["requests"] = []
        with self.assertRaises(BrowseError) as caught:
            flows.build_flow("x", steps)
        self.assertEqual(caught.exception.code, "nothing_to_save")
        with self.assertRaises(Usage):
            flows.build_flow("bad name", search_steps())

    def test_embedded_json(self):
        html = ('<html><script id="__NEXT_DATA__" type="application/json">{"props":{"items":[{"a":1}]}}</script>'
                '<script type="application/ld+json">[{"@type":"Product"}]</script>'
                '<script>window.__STATE__ = {"x": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]};</script><script>console.log(1)</script></html>')
        blocks = flowlog.embedded_json(html)
        self.assertEqual([spec for spec, _, _ in blocks], [{"scriptId": "__NEXT_DATA__"}, {"scriptIndex": 1}, {"scriptIndex": 2}])
        self.assertEqual(flowlog.extract_embedded(html, {"scriptId": "__NEXT_DATA__"}), {"props": {"items": [{"a": 1}]}})
        self.assertEqual(flowlog.heaviest_block(html)[0], {"scriptIndex": 2})

    def test_fill_encodes_for_where_it_lands(self):
        url = flows.fill_url("https://a.com/p/{{id}}?q={{q}}", {"id": "a/b", "q": "x y&z"})
        self.assertEqual(url, "https://a.com/p/a%2Fb?q=x+y%26z")
        self.assertEqual(flows.fill_body("q={{q}}&n=1", "form", {"q": "a&b"}), "q=a%26b&n=1")
        with self.assertRaises(Usage):
            flows.fill_body("line {{q}}", "text", {"q": "a\nb"})

    def test_drift(self):
        signature = flows.signature(SEARCH)
        self.assertIsNone(flows.drift(signature, {**SEARCH, "results": []}))
        self.assertEqual(flows.drift(signature, {"query": "x", "total": 1}), "results is missing")
        self.assertEqual(flows.drift(signature, {**SEARCH, "total": "2"}), "total was a number, now a string")
        self.assertTrue(flows.list_gone("results", {"results": None}))

    def test_base_domain(self):
        self.assertEqual(flowlog.base_domain("www.shop.example.co.uk"), "example.co.uk")
        self.assertEqual(flowlog.base_domain("api.example.com"), "example.com")
        self.assertEqual(flowlog.base_domain("127.0.0.1"), "127.0.0.1")
        self.assertEqual(flows.site_of("http://127.0.0.1:8080/x"), "127.0.0.1:8080")
        self.assertEqual(flows.site_of("https://www.example.com/x"), "example.com")
        self.assertEqual(flowlog.base_domain("alice.github.io"), "alice.github.io")
        self.assertEqual(flowlog.base_domain("api.alice.github.io"), "alice.github.io")

    def test_credential_fields_in_bodies_are_redacted(self):
        self.assertEqual(flows.redact_body("q={{q}}&csrf_token=abc&n=1", "form"), ("q={{q}}&csrf_token=<redacted>&n=1", True))
        body, touched = flows.redact_body(json.dumps({"variables": {"q": "{{q}}"}, "authToken": "s3cr3t"}), "json")
        self.assertEqual((json.loads(body), touched), ({"variables": {"q": "{{q}}"}, "authToken": "<redacted>"}, True))
        steps = search_steps()
        steps[2]["requests"] = [dict(request("https://shop.example.com/api", SEARCH, method="POST", body="q=kettle&_csrf=zzz9",
                                             headers={"content-type": "application/x-www-form-urlencoded"}), id="s3r1")]
        flow, _ = flows.build_flow("form", steps, description="Two\nlines")
        output = flows.output_request(flow)
        self.assertEqual((output["body"], output["strippedAuth"]), ("q={{q}}&_csrf=<redacted>", True))
        self.assertEqual(flow["description"], "Two lines")
        self.assertNotIn("zzz9", json.dumps(flow))


class StoreTest(unittest.TestCase):
    def test_save_load_list_rm(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            flow, _ = flows.build_flow("search", search_steps(), description="Search the shop")
            path = flows.save(root, flow)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((root / "Flows").stat().st_mode), 0o700)
            self.assertEqual(flows.load(root, "example.com", "search")["name"], "search")
            rows = flows.listing(root)
            self.assertEqual(flows.signature_line(rows[0]), "search(q) — Search the shop")
            self.assertEqual(flows.locate(root, "search", None, None), "example.com")
            data = json.loads(path.read_text())
            data["extra"] = 1
            path.write_text(json.dumps(data))
            with self.assertRaises(BrowseError) as caught:
                flows.load(root, "example.com", "search")
            self.assertEqual(caught.exception.code, "flow_invalid")
            data.pop("extra")
            data["version"] = 2
            path.write_text(json.dumps(data))
            with self.assertRaises(BrowseError):
                flows.load(root, "example.com", "search")
            self.assertTrue(flows.remove(root, "example.com", "search"))
            with self.assertRaises(BrowseError) as caught:
                flows.load(root, "example.com", "search")
            self.assertEqual(caught.exception.code, "no_flow")

    def test_hint_once_per_site(self):
        class State:
            def __init__(self, root):
                self.config = {"data_root": str(root)}
                self.extras = {}

        with tempfile.TemporaryDirectory() as folder:
            flow, _ = flows.build_flow("search", search_steps())
            flows.save(Path(folder), flow)
            state = State(folder)
            self.assertIn("search(q)", flows.hint(state, "https://shop.example.com/"))
            self.assertIsNone(flows.hint(state, "https://shop.example.com/other"))
            self.assertIsNone(flows.hint(State(folder), "https://elsewhere.org/"))


class RunTest(unittest.TestCase):
    def setUp(self):
        self.flow, _ = flows.build_flow("search", search_steps())
        self.request = flows.output_request(self.flow)

    def test_params(self):
        self.assertEqual(flowrun.resolve_params(self.flow, {"q": "toaster"}), {"q": "toaster"})
        with self.assertRaises(Usage) as caught:
            flowrun.resolve_params(self.flow, {})
        self.assertIn("--param q=", caught.exception.message)
        with self.assertRaises(Usage) as caught:
            flowrun.resolve_params(self.flow, {"term": "x"})
        self.assertIn("its params are: q", caught.exception.message)
        with self.assertRaises(Usage):
            flowrun.allowed_writes("w9", self.flow)

    def test_outcomes(self):
        def outcome(answer, write=False):
            return flowrun.classify(self.flow, self.request, answer, write)

        self.assertEqual(outcome({"status": 200, "mime": "application/json", "text": json.dumps(SEARCH)}).kind, "ok")
        self.assertEqual(outcome({"status": 401, "text": ""}).error.code, "auth_expired")
        self.assertEqual(outcome({"status": 429, "text": "", "retryAfter": "30"}).error.data["retryAfter"], "30")
        self.assertEqual(outcome({"status": 200, "mime": "text/html", "text": "<title>Just a moment...</title>"}).error.code, "blocked")
        drifted = outcome({"status": 200, "mime": "application/json", "text": json.dumps({"query": "x"})})
        self.assertEqual((drifted.kind, drifted.drift), ("next", "results is missing"))
        self.assertEqual(outcome({"status": 503, "text": ""}).kind, "next")
        self.assertEqual(outcome({"status": 503, "text": ""}, write=True).error.code, "outcome_unknown")
        self.assertEqual(outcome({"error": "reset"}, write=True).error.code, "outcome_unknown")
        self.assertEqual(outcome({"status": 404, "text": ""}).error.code, "http_error")
        self.assertEqual(outcome({"status": 200, "url": "https://evil.net/x", "text": "{}"}).error.code, "off_site")

    def test_replay_matching(self):
        url = flows.fill_url(self.request["url"], {"q": "toaster"})
        self.assertTrue(flowrun.same_request(self.request, url, "GET", {"method": "GET", "url": url + "&_=123"}))
        self.assertFalse(flowrun.same_request(self.request, url, "GET", {"method": "GET", "url": url.replace("toaster", "kettle")}))
        self.assertEqual(flowrun.replay_commands(self.flow, {"q": "toaster"})[1], ["fill", "#q", "toaster"])


if __name__ == "__main__":
    unittest.main()
