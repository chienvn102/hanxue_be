"""
HanXue Database Normalization Script
=====================================
Sử dụng Gemini API để chuẩn hóa:
- meaning_vi, meaning_en cho từ vựng
- sentences (câu ví dụ)
- Bổ sung các trường còn thiếu

Cách chạy:
  python batch_normalize.py

Yêu cầu:
  pip install google-generativeai mysql-connector-python python-dotenv
"""

import os
import json
import time
import mysql.connector
from dotenv import load_dotenv
import google.generativeai as genai

# Load environment variables
load_dotenv()

# ==================== CẤU HÌNH ====================
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')  # Thêm vào .env
def required_env(name):
    value = os.getenv(name)
    if not value:
        raise ValueError(f"{name} is not configured in .env")
    return value

DB_CONFIG = {
    'host': required_env('DB_HOST'),
    'user': required_env('DB_USER'),
    'password': os.getenv('DB_PASSWORD', ''),
    'database': required_env('DB_NAME'),
    'charset': 'utf8mb4'
}

# Batch size nhỏ hơn để tránh rate limit
BATCH_SIZE = 5
DELAY_BETWEEN_BATCHES = 10  # seconds - đợi lâu hơn

# ==================== SETUP GEMINI ====================
def setup_gemini():
    """Khởi tạo Gemini API"""
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY chưa được cấu hình trong .env")
    
    genai.configure(api_key=GEMINI_API_KEY)
    # Dùng gemini-2.0-flash (model mới nhất, miễn phí)
    model = genai.GenerativeModel('gemini-2.0-flash')
    return model

# ==================== DATABASE ====================
def get_db_connection():
    """Kết nối database"""
    return mysql.connector.connect(**DB_CONFIG)

def get_vocab_missing_meaning(limit=100):
    """Lấy từ vựng thiếu meaning_vi hoặc meaning_en"""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    
    query = """
        SELECT id, hanzi, pinyin, meaning_vi, meaning_en 
        FROM vocabularies 
        WHERE meaning_vi IS NULL OR meaning_vi = '' 
           OR meaning_en IS NULL OR meaning_en = ''
        LIMIT %s
    """
    cursor.execute(query, (limit,))
    results = cursor.fetchall()
    
    cursor.close()
    conn.close()
    return results

def get_vocab_missing_sentences(limit=100):
    """Lấy từ vựng thiếu sentences"""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    
    query = """
        SELECT id, hanzi, pinyin, meaning_vi, hsk_level
        FROM vocabularies 
        WHERE sentences IS NULL OR sentences = '[]' OR sentences = ''
        LIMIT %s
    """
    cursor.execute(query, (limit,))
    results = cursor.fetchall()
    
    cursor.close()
    conn.close()
    return results

def get_characters_missing_info(limit=100):
    """Lấy chữ Hán thiếu thông tin"""
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    
    query = """
        SELECT id, hanzi, pinyin_main, meaning_vi, meaning_en, mnemonics_vi
        FROM characters 
        WHERE meaning_vi IS NULL OR meaning_vi = ''
           OR mnemonics_vi IS NULL OR mnemonics_vi = ''
        LIMIT %s
    """
    cursor.execute(query, (limit,))
    results = cursor.fetchall()
    
    cursor.close()
    conn.close()
    return results

def update_vocab_meaning(vocab_id, meaning_vi, meaning_en):
    """Cập nhật meaning cho từ vựng"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = """
        UPDATE vocabularies 
        SET meaning_vi = %s, meaning_en = %s 
        WHERE id = %s
    """
    cursor.execute(query, (meaning_vi, meaning_en, vocab_id))
    conn.commit()
    
    cursor.close()
    conn.close()

def update_vocab_sentences(vocab_id, sentences_json):
    """Cập nhật sentences cho từ vựng"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = """
        UPDATE vocabularies 
        SET sentences = %s 
        WHERE id = %s
    """
    cursor.execute(query, (sentences_json, vocab_id))
    conn.commit()
    
    cursor.close()
    conn.close()

def update_character_info(char_id, meaning_vi, meaning_en, mnemonics_vi):
    """Cập nhật thông tin cho chữ Hán"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = """
        UPDATE characters 
        SET meaning_vi = %s, meaning_en = %s, mnemonics_vi = %s
        WHERE id = %s
    """
    cursor.execute(query, (meaning_vi, meaning_en, mnemonics_vi, char_id))
    conn.commit()
    
    cursor.close()
    conn.close()

# ==================== GEMINI PROMPTS ====================
def generate_meaning(model, hanzi, pinyin):
    """Sinh nghĩa tiếng Việt và tiếng Anh cho từ vựng"""
    prompt = f"""
Bạn là chuyên gia ngôn ngữ học tiếng Trung. Cho từ vựng sau:
- Chữ Hán: {hanzi}
- Pinyin: {pinyin}

Hãy cung cấp:
1. meaning_vi: Nghĩa tiếng Việt (ngắn gọn, chính xác)
2. meaning_en: Nghĩa tiếng Anh (ngắn gọn)

Trả về JSON format:
{{"meaning_vi": "...", "meaning_en": "..."}}

Chỉ trả về JSON, không giải thích thêm.
"""
    
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        # Clean JSON
        if text.startswith('```'):
            text = text.split('```')[1]
            if text.startswith('json'):
                text = text[4:]
        return json.loads(text)
    except Exception as e:
        print(f"  ❌ Lỗi generate meaning cho {hanzi}: {e}")
        return None

def generate_sentences(model, hanzi, pinyin, meaning_vi, hsk_level):
    """Sinh câu ví dụ cho từ vựng"""
    level = hsk_level or 1
    prompt = f"""
Bạn là giáo viên tiếng Trung. Tạo 2 câu ví dụ cho từ vựng:
- Chữ Hán: {hanzi}
- Pinyin: {pinyin}
- Nghĩa: {meaning_vi}
- Trình độ: HSK {level}

Yêu cầu:
- Câu phù hợp trình độ HSK {level}
- Có pinyin và nghĩa tiếng Việt
- Thực tế, dễ hiểu

Trả về JSON array:
[
  {{"chinese": "...", "pinyin": "...", "vietnamese": "..."}},
  {{"chinese": "...", "pinyin": "...", "vietnamese": "..."}}
]

Chỉ trả về JSON array, không giải thích thêm.
"""
    
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        # Clean JSON
        if text.startswith('```'):
            text = text.split('```')[1]
            if text.startswith('json'):
                text = text[4:]
        return json.loads(text)
    except Exception as e:
        print(f"  ❌ Lỗi generate sentences cho {hanzi}: {e}")
        return None

def generate_character_info(model, hanzi, pinyin):
    """Sinh thông tin cho chữ Hán"""
    prompt = f"""
Bạn là chuyên gia Hán tự. Cho chữ Hán:
- Chữ: {hanzi}
- Pinyin: {pinyin}

Hãy cung cấp:
1. meaning_vi: Nghĩa tiếng Việt đầy đủ
2. meaning_en: Nghĩa tiếng Anh
3. mnemonics_vi: Gợi ý cách nhớ chữ bằng tiếng Việt (sáng tạo, dễ nhớ)

Trả về JSON format:
{{"meaning_vi": "...", "meaning_en": "...", "mnemonics_vi": "..."}}

Chỉ trả về JSON, không giải thích thêm.
"""
    
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith('```'):
            text = text.split('```')[1]
            if text.startswith('json'):
                text = text[4:]
        return json.loads(text)
    except Exception as e:
        print(f"  ❌ Lỗi generate info cho {hanzi}: {e}")
        return None

# ==================== MAIN FUNCTIONS ====================
def normalize_vocab_meanings(model, limit=100):
    """Chuẩn hóa meaning cho từ vựng"""
    print("\n" + "="*50)
    print("📚 CHUẨN HÓA NGHĨA TỪ VỰNG")
    print("="*50)
    
    vocabs = get_vocab_missing_meaning(limit)
    print(f"Tìm thấy {len(vocabs)} từ cần chuẩn hóa meaning")
    
    if not vocabs:
        print("✅ Tất cả từ vựng đã có meaning!")
        return
    
    success = 0
    for i, vocab in enumerate(vocabs):
        print(f"\n[{i+1}/{len(vocabs)}] {vocab['hanzi']} ({vocab['pinyin']})...")
        
        result = generate_meaning(model, vocab['hanzi'], vocab['pinyin'])
        if result:
            update_vocab_meaning(
                vocab['id'], 
                result.get('meaning_vi', ''),
                result.get('meaning_en', '')
            )
            print(f"  ✅ {result['meaning_vi']} / {result['meaning_en']}")
            success += 1
        
        # Rate limit
        if (i + 1) % BATCH_SIZE == 0:
            print(f"\n⏳ Đợi {DELAY_BETWEEN_BATCHES}s để tránh rate limit...")
            time.sleep(DELAY_BETWEEN_BATCHES)
    
    print(f"\n✅ Hoàn thành: {success}/{len(vocabs)} từ")

def normalize_vocab_sentences(model, limit=100):
    """Tạo câu ví dụ cho từ vựng"""
    print("\n" + "="*50)
    print("📝 TẠO CÂU VÍ DỤ CHO TỪ VỰNG")
    print("="*50)
    
    vocabs = get_vocab_missing_sentences(limit)
    print(f"Tìm thấy {len(vocabs)} từ cần tạo sentences")
    
    if not vocabs:
        print("✅ Tất cả từ vựng đã có sentences!")
        return
    
    success = 0
    for i, vocab in enumerate(vocabs):
        print(f"\n[{i+1}/{len(vocabs)}] {vocab['hanzi']}...")
        
        result = generate_sentences(
            model, 
            vocab['hanzi'], 
            vocab['pinyin'],
            vocab['meaning_vi'] or '',
            vocab['hsk_level']
        )
        if result:
            update_vocab_sentences(vocab['id'], json.dumps(result, ensure_ascii=False))
            print(f"  ✅ Đã tạo {len(result)} câu ví dụ")
            success += 1
        
        if (i + 1) % BATCH_SIZE == 0:
            print(f"\n⏳ Đợi {DELAY_BETWEEN_BATCHES}s...")
            time.sleep(DELAY_BETWEEN_BATCHES)
    
    print(f"\n✅ Hoàn thành: {success}/{len(vocabs)} từ")

def normalize_characters(model, limit=100):
    """Chuẩn hóa thông tin chữ Hán"""
    print("\n" + "="*50)
    print("🔤 CHUẨN HÓA THÔNG TIN CHỮ HÁN")
    print("="*50)
    
    chars = get_characters_missing_info(limit)
    print(f"Tìm thấy {len(chars)} chữ cần chuẩn hóa")
    
    if not chars:
        print("✅ Tất cả chữ Hán đã có đủ thông tin!")
        return
    
    success = 0
    for i, char in enumerate(chars):
        print(f"\n[{i+1}/{len(chars)}] {char['hanzi']}...")
        
        result = generate_character_info(model, char['hanzi'], char['pinyin_main'])
        if result:
            update_character_info(
                char['id'],
                result.get('meaning_vi', ''),
                result.get('meaning_en', ''),
                result.get('mnemonics_vi', '')
            )
            print(f"  ✅ {result.get('meaning_vi', '')[:30]}...")
            success += 1
        
        if (i + 1) % BATCH_SIZE == 0:
            print(f"\n⏳ Đợi {DELAY_BETWEEN_BATCHES}s...")
            time.sleep(DELAY_BETWEEN_BATCHES)
    
    print(f"\n✅ Hoàn thành: {success}/{len(chars)} chữ")

def main():
    """Main function"""
    print("="*60)
    print("🚀 HANXUE DATABASE NORMALIZATION")
    print("="*60)
    
    # Setup
    print("\n📡 Đang kết nối Gemini API...")
    model = setup_gemini()
    print("✅ Kết nối thành công!")
    
    # Menu - chỉ dùng characters table
    print("\n📋 Chọn chức năng:")
    print("1. Chuẩn hóa thông tin chữ Hán (meaning_vi, meaning_en, mnemonics)")
    print("0. Thoát")
    
    choice = input("\n👉 Nhập lựa chọn (0-1): ").strip()
    
    limit = 50  # Số lượng xử lý mỗi lần
    
    if choice == '1':
        normalize_characters(model, limit)
    elif choice == '0':
        print("👋 Tạm biệt!")
    else:
        print("❌ Lựa chọn không hợp lệ!")
    
    print("\n" + "="*60)
    print("🏁 KẾT THÚC")
    print("="*60)

if __name__ == "__main__":
    main()
