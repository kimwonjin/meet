-- 테스트 데이터: 010-4444
-- 앞 두 자리 = 파트너 번호, 뒤 두 자리 = 00은 파트너, 01~09는 그 파트너의 회원
--   1번 파트너 010-4444-0100 → 회원 0101 ~ 0109
--   2번 파트너 010-4444-0200 → 회원 0201 ~ 0209
--   …
--  10번 파트너 010-4444-1000 → 회원 1001 ~ 1009
-- 회원 끝자리 홀수 = 여자(5명), 짝수 = 남자(4명). 프로필·사진은 무작위
-- 회원마다 담당 파트너 이용권 10회
-- 다시 실행해도 중복으로 생기지 않는다

BEGIN;

-- 1) 파트너
INSERT INTO users (phone, name, birth_date, gender, role)
SELECT '010-4444-' || lpad((k * 100)::text, 4, '0'),
       '테스트파트너' || k, '1985-01-01', 'M', 'connector'
FROM generate_series(1, 10) k
ON CONFLICT (phone) DO NOTHING;

INSERT INTO connectors (id, business_name, status, fee_per_session, main_region, career, intro, profile_status)
SELECT u.id,
       (ARRAY['하늘','다온','소담','이음','온새','가람','누리','보람','한결','라온'])[k] || '결혼정보',
       'approved',
       (ARRAY[30000,40000,50000,60000,80000,100000,120000,150000,50000,70000])[k],
       (ARRAY['["서울"]','["서울","경기"]','["경기"]','["인천","경기"]','["서울"]','["경상"]','["충청"]','["전라"]','["서울","인천"]','["강원"]'])[k],
       '결혼정보회사 근무 ' || (2 + k) || '년',
       '진지한 만남을 원하는 분들을 정성껏 소개해 드려요.',
       'APPROVED'
FROM generate_series(1, 10) k
JOIN users u ON u.phone = '010-4444-' || lpad((k * 100)::text, 4, '0')
ON CONFLICT (id) DO NOTHING;

-- 2) 회원 (90명)
WITH m AS (
  SELECT k, n, k * 100 + n AS num,
         CASE WHEN n % 2 = 0 THEN 'M' ELSE 'F' END AS g,
         make_date(1986 + floor(random() * 14)::int, 1 + floor(random() * 12)::int, 1 + floor(random() * 28)::int) AS bd
  FROM generate_series(1, 10) k, generate_series(1, 9) n
)
INSERT INTO users (phone, name, birth_date, age, gender, role,
                   location, height, job, education, bio, religion, smoking, drinking, body_type, photo_urls)
SELECT '010-4444-' || lpad(num::text, 4, '0'),
       (ARRAY['김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권'])[1 + floor(random() * 15)::int]
         || CASE WHEN g = 'M'
              THEN (ARRAY['민준','서준','도윤','예준','시우','하준','주원','지호','준서','건우','현우','우진','선우','유준','정우'])[1 + floor(random() * 15)::int]
              ELSE (ARRAY['서연','서윤','지우','서현','민서','하은','하윤','윤서','지민','채원','수아','지아','지유','다은','예린'])[1 + floor(random() * 15)::int]
            END,
       bd,
       date_part('year', age(bd))::int,
       g, 'hopeful',
       (ARRAY['서울','서울','서울','경기','경기','인천','강원','충청','전라','경상','제주'])[1 + floor(random() * 11)::int],
       CASE WHEN g = 'M' THEN 168 + floor(random() * 17)::int ELSE 155 + floor(random() * 16)::int END,
       (ARRAY['회사원','공무원','교사','간호사','개발자','디자이너','연구원','은행원','자영업','약사','회계사','마케터'])[1 + floor(random() * 12)::int],
       (ARRAY['고졸','대졸','대졸','대졸','대학원졸'])[1 + floor(random() * 5)::int],
       (ARRAY['주말엔 등산하고 맛집 찾아다니는 걸 좋아해요.',
              '조용히 책 읽고 산책하는 시간을 좋아해요.',
              '운동을 꾸준히 하고 있어요. 함께 걸을 사람을 찾아요.',
              '여행과 사진 찍기를 좋아해요.',
              '요리하는 걸 좋아해서 집밥을 자주 해 먹어요.',
              '대화가 잘 통하는 사람을 만나고 싶어요.'])[1 + floor(random() * 6)::int],
       (ARRAY['기독교','천주교','불교','무교','무교','무교'])[1 + floor(random() * 6)::int],
       (ARRAY['비흡연','비흡연','비흡연','흡연','가끔'])[1 + floor(random() * 5)::int],
       (ARRAY['비음주','가끔','가끔','자주'])[1 + floor(random() * 4)::int],
       (ARRAY['마름','보통','보통','통통','근육질'])[1 + floor(random() * 5)::int],
       ARRAY['https://randomuser.me/api/portraits/' || CASE WHEN g = 'M' THEN 'men' ELSE 'women' END || '/' || (k * 9 + n) || '.jpg']
FROM m
ON CONFLICT (phone) DO NOTHING;

-- 3) 회원 → 파트너 가입 승인
INSERT INTO hopeful_requests (hopeful_id, connector_id, status, message)
SELECT h.id, c.id, 'approved', h.name || '님이 가입을 요청했습니다.'
FROM generate_series(1, 10) k
CROSS JOIN generate_series(1, 9) n
JOIN users c ON c.phone = '010-4444-' || lpad((k * 100)::text, 4, '0')
JOIN users h ON h.phone = '010-4444-' || lpad((k * 100 + n)::text, 4, '0')
WHERE NOT EXISTS (SELECT 1 FROM hopeful_requests r WHERE r.hopeful_id = h.id AND r.connector_id = c.id);

-- 4) 이용권 10회씩
INSERT INTO payments (hopeful_id, connector_id, session_count, amount_total, amount_per_session, sessions_remaining, status, pg_provider, paid_at)
SELECT r.hopeful_id, r.connector_id, 10, c.fee_per_session * 10, c.fee_per_session, 10, 'paid', 'mock', now()
FROM hopeful_requests r
JOIN users h ON h.id = r.hopeful_id
JOIN connectors c ON c.id = r.connector_id
WHERE h.phone LIKE '010-4444-%' AND r.status = 'approved'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.hopeful_id = r.hopeful_id AND p.connector_id = r.connector_id);

COMMIT;

-- 확인: 파트너 10줄, 각 회원 9 · 남 4 · 여 5 · 이용권 90
SELECT c.phone AS 파트너, count(*) AS 회원수,
       count(*) FILTER (WHERE h.gender = 'M') AS 남, count(*) FILTER (WHERE h.gender = 'F') AS 여,
       (SELECT sum(p.sessions_remaining) FROM payments p WHERE p.connector_id = c.id AND p.status = 'paid') AS 이용권
FROM hopeful_requests r
JOIN users c ON c.id = r.connector_id
JOIN users h ON h.id = r.hopeful_id
WHERE c.phone LIKE '010-4444-%' AND r.status = 'approved'
GROUP BY c.id, c.phone ORDER BY c.phone;
