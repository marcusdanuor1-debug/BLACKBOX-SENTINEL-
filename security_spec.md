# Security Specification for Dex AI

## Data Invariants
- A conversation MUST belong to the authenticated user (`userId == request.auth.uid`).
- A message MUST belong to a conversation that exists and is owned by the user.
- Users can only read and write their own data.
- Timestamps must be server-generated.
- ID formats must be strictly validated.

## The Dirty Dozen Payloads (Target: /users/{userId}/conversations/{convId})

1. **Identity Spoofing**: `{"id": "conv1", "title": "Steal", "userId": "victim_uid", ...}` -> Should be rejected (userId mismatch).
2. **Ghost Field Injection**: `{"id": "conv1", "isAdmin": true, ...}` -> Should be rejected (strict schema).
3. **Malicious ID**: Attempt to create conversation with ID `../../../etc/passwd`. -> Should be rejected (`isValidId`).
4. **Denial of Wallet**: Message content `{"content": "A" * 1000000}`. -> Should be rejected (size limit).
5. **Timestamp Manipulation**: `{"createdAt": "2000-01-01T00:00:00Z"}`. -> Should be rejected (must be `request.time`).
6. **Cross-User Access**: Attacker `uid_a` tries to `get` `/users/uid_b/conversations/conv1`. -> Should be rejected.
7. **Cross-Conversation Message**: Attacker tries to write a message to `conv2` while claiming it belongs to `conv1`. -> Inherently blocked by path.
8. **Invalid Role**: `{"role": "admin", "content": "hello"}`. -> Should be rejected (enum check).
9. **Zombie Update**: Updating `createdAt` after creation. -> Should be rejected (immutability).
10. **Resource Exhaustion**: Creating 10,000 conversations in a loop. -> Rates limits apply, but rules can restrict metadata size.
11. **Unverified Email**: Accessing data with `email_verified: false` (if required). -> Should be rejected.
12. **Orphaned Message**: Creating a message in a conversation that doesn't exist (if checked via `exists`).

## Test Runner
(I will implement a simulated test verification in my logic, but the rules will be hard-coded for maximum security).
