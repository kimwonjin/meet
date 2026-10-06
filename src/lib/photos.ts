import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from './supabase';

export const PHOTO_BUCKET = 'profile-photos';
export const MAX_PHOTOS = 3;

// 사진 칸은 자리가 고정이라, 지운 칸은 빈 문자열('')로 저장된다.
// 다른 사람에게 보여줄 때는 빈 칸을 건너뛴다 (대표 칸이 비면 다음 사진이 대신 보임).
export function shownPhotos(urls?: string[] | null): string[] {
  return (urls ?? []).filter(Boolean);
}
// 업로드 전에 긴 변 기준 이 크기로 줄인다 (용량·속도)
const MAX_WIDTH = 1080;

// 앨범에서 사진 1장을 골라 줄인 뒤 Storage에 올리고 공개 주소를 돌려준다.
// 사용자가 취소하면 null, 실패하면 Error를 던진다.
export async function pickAndUploadPhoto(userId: string): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('사진 접근 권한이 필요합니다. 설정에서 사진 접근을 허용해주세요.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [3, 4],
    quality: 1,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const resized = await manipulateAsync(
    asset.uri,
    asset.width > MAX_WIDTH ? [{ resize: { width: MAX_WIDTH } }] : [],
    { compress: 0.8, format: SaveFormat.JPEG }
  );

  const body = await (await fetch(resized.uri)).arrayBuffer();
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, body, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;

  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

// 공개 주소에서 Storage 경로를 뽑아 파일을 지운다. 실패해도 목록에서는 빠지므로 에러는 무시한다.
export async function deletePhoto(publicUrl: string) {
  const marker = `/${PHOTO_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index < 0) return;
  await supabase.storage.from(PHOTO_BUCKET).remove([publicUrl.slice(index + marker.length)]);
}

export async function savePhotoUrls(userId: string, photoUrls: string[]) {
  // 뒤쪽 빈 칸은 저장하지 않는다
  const slots = [...photoUrls];
  while (slots.length && !slots[slots.length - 1]) slots.pop();
  const { error } = await supabase.from('users').update({ photo_urls: slots }).eq('id', userId);
  if (error) throw error;
}
