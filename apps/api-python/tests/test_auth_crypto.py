from ai_video_api.auth import digest_session, hash_password, verify_password

NODE_HASH = "00112233445566778899aabbccddeeff:d737a9667c77c7d2fb521018166b32b9465292840814eee55a30fa551cfa13a6c3005dc07a636ee4b68a7fb37896ac65996491ee3baf96eff493e05848f11e13"


def test_existing_node_scrypt_hash_verifies():
    assert verify_password("ExamplePassword123!", NODE_HASH)
    assert not verify_password("wrong password", NODE_HASH)
    assert not verify_password("anything", "bad-hash")


def test_python_hash_can_be_verified():
    stored = hash_password("ExamplePassword123!")
    assert verify_password("ExamplePassword123!", stored)
    assert not verify_password("wrong", stored)


def test_session_digest_matches_node_hmac():
    assert digest_session("test-session-id", "x" * 32) == "97a425a7e6896bf2792d0861ad46f2ad15448f2afb2ca6f2fbbceb76698f6326"
