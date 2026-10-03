-- 회원 프로필 사진: users.photo_urls에 공개 주소 목록(첫 번째가 대표 사진)을 저장하고,
-- 파일은 Storage의 profile-photos 버킷에 둔다.
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-photos', 'profile-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- 테스트 단계: 앱이 아직 Supabase Auth를 쓰지 않아 anon 키로 올리고 지운다.
-- 보안 작업(문자 인증 도입) 때 본인 폴더에만 쓸 수 있도록 바꿔야 한다.
DROP POLICY IF EXISTS profile_photos_read ON storage.objects;
DROP POLICY IF EXISTS profile_photos_insert ON storage.objects;
DROP POLICY IF EXISTS profile_photos_delete ON storage.objects;
CREATE POLICY profile_photos_read ON storage.objects FOR SELECT USING (bucket_id = 'profile-photos');
CREATE POLICY profile_photos_insert ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'profile-photos');
CREATE POLICY profile_photos_delete ON storage.objects FOR DELETE USING (bucket_id = 'profile-photos');
