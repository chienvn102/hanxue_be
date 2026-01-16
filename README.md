# HanXue API

Backend API cho ứng dụng học tiếng Trung HanXue.

## Tech Stack

- Node.js + Express
- MySQL/MariaDB
- JWT Authentication

## Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your settings
nano .env

# Run development
npm run dev

# Run production
npm start
```

## API Endpoints

### Auth
- `POST /api/auth/register` - Đăng ký
- `POST /api/auth/login` - Đăng nhập
- `POST /api/auth/refresh` - Refresh token
- `GET /api/auth/me` - Thông tin user

### Vocabulary
- `GET /api/vocab` - Danh sách từ vựng
- `GET /api/vocab/:id` - Chi tiết từ vựng
- `GET /api/vocab/search?q=` - Tìm kiếm

### Characters
- `GET /api/characters/:hanzi` - Chi tiết chữ Hán
- `GET /api/characters/:hanzi/stroke` - Stroke order

### HSK Tests
- `GET /api/hsk/tests` - Danh sách đề thi
- `GET /api/hsk/tests/:id` - Chi tiết đề thi
- `POST /api/hsk/tests/:id/submit` - Nộp bài

## License

MIT
