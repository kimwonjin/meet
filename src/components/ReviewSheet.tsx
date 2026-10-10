import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';

interface ReviewSheetProps {
  visible: boolean;
  partnerName?: string;
  // 만난 사람 이름: 후기 대상(파트너)과 헷갈리지 않게 '누구를 소개해 준 파트너'인지 알려준다
  metName?: string;
  onClose: () => void;
  onSubmit: (rating: number, content: string) => Promise<void>;
}

// 매칭을 마친 회원이 자기 파트너에게 남기는 후기 (별점 + 한 줄 후기)
export default function ReviewSheet({ visible, partnerName, metName, onClose, onSubmit }: ReviewSheetProps) {
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setRating(0);
      setContent('');
    }
  }, [visible]);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(rating, content);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="파트너 후기 남기기">
      <Text style={styles.label}>{partnerName ? `${partnerName} 파트너의 소개는 어떠셨나요?` : '파트너의 소개는 어떠셨나요?'}</Text>
      <Text style={styles.about}>
        {metName ? `${metName}님을 소개해 준 파트너에 대한 후기예요.` : '나를 소개해 준 파트너에 대한 후기예요.'} 만난 분에 대한 평가가 아니에요.
      </Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity key={n} onPress={() => setRating(n)} style={styles.starBtn} accessibilityLabel={`별 ${n}개`}>
            <Text style={[styles.star, n <= rating && styles.starOn]}>★</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        placeholder="파트너의 소개·연락·배려는 어땠나요? (선택)"
        placeholderTextColor="#98959E"
        value={content}
        onChangeText={setContent}
        multiline
        maxLength={200}
      />
      <Text style={styles.hint}>후기는 이름 첫 글자만 표시돼요 (예: 김**)</Text>
      <TouchableOpacity
        style={[styles.submit, (rating === 0 || submitting) && styles.disabled]}
        disabled={rating === 0 || submitting}
        onPress={handleSubmit}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{rating === 0 ? '별점을 선택해주세요' : '후기 등록하기'}</Text>}
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  about: { fontSize: 13, color: '#87848D', marginTop: 4, marginBottom: 12, lineHeight: 19 },
  label: { fontSize: 15, fontWeight: '600', color: '#211E27' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginBottom: 16 },
  starBtn: { padding: 6 },
  star: { fontSize: 36, color: '#DCD9E2' },
  starOn: { color: '#5B21FF' },
  input: {
    borderWidth: 1,
    borderColor: '#E4E1EA',
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    fontSize: 14,
    color: '#211E27',
    textAlignVertical: 'top',
  },
  hint: { fontSize: 12, color: '#98959E', marginTop: 8, marginBottom: 16 },
  submit: { backgroundColor: '#5B21FF', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
