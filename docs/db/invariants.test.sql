\pset pager off
\set QUIET on

INSERT INTO student (id, subject_claim, email, display_name)
VALUES ('11111111-1111-1111-1111-111111111111','sub-tom','tom@x','Tom');
INSERT INTO test (id, slug) VALUES ('22222222-2222-2222-2222-222222222222','t04');

-- v1: draft -> content -> publish  (a draft must be published before the next exists)
INSERT INTO test_version (id, test_id, version, title, duration_seconds)
VALUES ('a0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',1,'T04',3000);
INSERT INTO test_section (id, test_version_id, ordinal, title, type, duration_seconds, navigation, allow_answer_change)
VALUES ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',1,'L','listening',3000,'forward_only',false);
INSERT INTO question_group (id, test_version_id, test_section_id, ordinal)
VALUES ('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',1);
INSERT INTO question (id, test_version_id, question_group_id, question_key, ordinal, prompt, type, points)
VALUES ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','q1',1,'v1 question','single_choice',1);
UPDATE test_version SET published_at = now() WHERE id='a0000000-0000-0000-0000-000000000001';

-- v2: draft -> content -> publish
INSERT INTO test_version (id, test_id, version, title, duration_seconds)
VALUES ('a0000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',2,'T04',6000);
INSERT INTO test_section (id, test_version_id, ordinal, title, type, duration_seconds, navigation, allow_answer_change) VALUES
 ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002',1,'L','listening',3000,'forward_only',false),
 ('b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002',2,'R','reading',3000,'free',true);
INSERT INTO question_group (id, test_version_id, test_section_id, ordinal) VALUES
 ('c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002',1),
 ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003',1);
INSERT INTO question (id, test_version_id, question_group_id, question_key, ordinal, prompt, type, points) VALUES
 ('d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','q1',1,'v2 q1','single_choice',1),
 ('d0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003','q2',2,'v2 q2','single_choice',1);
INSERT INTO choice (id, question_id, ordinal, label, is_correct) VALUES
 ('e0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002',1,'A',true),
 ('e0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002',2,'B',false),
 ('e0000000-0000-0000-0000-000000000009','d0000000-0000-0000-0000-000000000003',1,'other-q choice',true),
 ('e000000a-0000-0000-0000-000000000009','d0000000-0000-0000-0000-000000000003',2,'other-q choice 2',false);
UPDATE test_version SET published_at = now() WHERE id='a0000000-0000-0000-0000-000000000002';
UPDATE test SET current_version_id='a0000000-0000-0000-0000-000000000002' WHERE id='22222222-2222-2222-2222-222222222222';

INSERT INTO attempt (id, student_id, test_version_id)
VALUES ('f0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000002');

\set QUIET off
\echo '--- 1 cross-version response (v1 question, v2 attempt) MUST FAIL'
INSERT INTO response (attempt_id, question_id, test_version_id, client_instance_id, client_seq)
VALUES ('f0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','ci',1);
\echo '--- 2 same-version response MUST SUCCEED'
INSERT INTO response (attempt_id, question_id, test_version_id, client_instance_id, client_seq)
VALUES ('f0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','ci',1);
\echo '--- 3 choice from a DIFFERENT question MUST FAIL'
INSERT INTO response_choice (attempt_id, question_id, choice_id)
VALUES ('f0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000009');
\echo '--- 4 own choice MUST SUCCEED'
INSERT INTO response_choice (attempt_id, question_id, choice_id)
VALUES ('f0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001');
\echo '--- 5 second in-progress attempt MUST FAIL'
INSERT INTO attempt (id, student_id, test_version_id)
VALUES ('f0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000002');
\echo '--- 6 half-started clock MUST FAIL'
UPDATE attempt SET started_at=now() WHERE id='f0000000-0000-0000-0000-000000000001';
\echo '--- 6b full clock MUST SUCCEED'
UPDATE attempt SET started_at=now(), expires_at=now()+interval '50 min' WHERE id='f0000000-0000-0000-0000-000000000001';
\echo '--- 7 first section entry MUST SUCCEED'
INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id, expires_at)
VALUES ('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002',now()+interval '25 min');
\echo '--- 7b SECOND open section MUST FAIL'
INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id, expires_at)
VALUES ('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002',now()+interval '25 min');
\echo '--- 8 expired attempt not pinned to deadline MUST FAIL'
UPDATE attempt SET status='expired', submitted_at=now()+interval '99 min',
  points_earned=1,points_possible=2,percentage=50,answered_count=1,unanswered_count=1,
  correct_count=1,incorrect_count=0,question_count=2 WHERE id='f0000000-0000-0000-0000-000000000001';
\echo '--- 8b expired pinned to deadline MUST SUCCEED'
UPDATE attempt SET status='expired', submitted_at=expires_at,
  points_earned=1,points_possible=2,percentage=50,answered_count=1,unanswered_count=1,
  correct_count=1,incorrect_count=0,question_count=2 WHERE id='f0000000-0000-0000-0000-000000000001';
\echo '--- 9 editing a PUBLISHED question MUST FAIL'
UPDATE question SET prompt='tampered' WHERE id='d0000000-0000-0000-0000-000000000001';
\echo '--- 10 deleting a media asset in use MUST FAIL (none cited here; skipped)'
\echo '--- 11 completed section with NULL counts MUST FAIL'
INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id, expires_at, completed_at)
VALUES ('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002',now()+interval '25 min',now());
\echo '--- 11b completed section whose counts reconcile MUST SUCCEED'
INSERT INTO attempt_section (attempt_id, test_section_id, test_version_id, expires_at, completed_at,
                             answered_count, correct_count, incorrect_count)
VALUES ('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002',now()+interval '25 min',now(),1,1,0);
\echo '--- 12 publication violations on a NEW draft'
INSERT INTO test_version (id, test_id, version, title, duration_seconds)
VALUES ('a0000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222',3,'T04 draft',9999);
INSERT INTO test_section (id, test_version_id, ordinal, title, type, duration_seconds, navigation, allow_answer_change)
VALUES ('b0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000003',1,'L','listening',100,'forward_only',false);
INSERT INTO question_group (id, test_version_id, test_section_id, ordinal)
VALUES ('c0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000004',1);
INSERT INTO question (id, test_version_id, question_group_id, question_key, ordinal, prompt, type, points)
VALUES ('d0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000004','q1',1,'lonely','single_choice',1);
INSERT INTO choice (id, question_id, ordinal, label, is_correct)
VALUES ('e0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000004',1,'only one',false);
SELECT rule, detail FROM publication_violation
 WHERE test_version_id='a0000000-0000-0000-0000-000000000003' ORDER BY rule;
