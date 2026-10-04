import { supabase } from './supabase';

export function calculateAge(birthDate: string): number {
  const [year, month, day] = birthDate.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) {
    age--;
  }
  return age;
}

export async function signUpHopeful(phone: string, name: string, birthDate: string, gender: 'M' | 'F') {
  try {
    // 중복 확인
    const { data: existing, error: checkError } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existing) {
      return { data: null, error: new Error('duplicate key value violates unique constraint') };
    }

    const age = calculateAge(birthDate);

    const { data, error } = await supabase
      .from('users')
      .insert([{
        phone,
        name,
        birth_date: birthDate,
        age: age,
        gender,
        role: 'hopeful',
      }])
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function signUpConnector(phone: string, businessName: string) {
  try {
    // 중복 확인
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existing) {
      return { data: null, error: new Error('duplicate key value violates unique constraint') };
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .insert([{
        phone,
        name: businessName,
        birth_date: '1990-01-01',
        gender: 'M',
        role: 'connector',
      }])
      .select()
      .single();

    if (userError) throw userError;

    const { data: connector, error: connectorError } = await supabase
      .from('connectors')
      .insert([{
        id: user.id,
        business_name: businessName,
      }])
      .select()
      .single();

    if (connectorError) throw connectorError;
    return { data: { user, connector }, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function loginWithPhone(phone: string) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function getConnectors() {
  try {
    const { data, error } = await supabase
      .from('connectors')
      .select('*, users:id(name, grade)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}
