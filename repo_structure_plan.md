Đây là cấu trúc mới cho repo, hãy refactor source code và đem ma sói hiện tại vào gamehub/games/werewolves.


gamehub/
├── apps/
│   ├── home/                  # Main GameHub frontend
│   └── server/                  # Backend, accounts, scores, leaderboards
├── games/
│   ├── werewolves/
│   ├── game-2/
│   ├── game-3/
│   └── game-4/
├── packages/
│   ├── game-sdk/             # Shared game interface and lifecycle
│   ├── ui/                   # Buttons, dialogs, menus
│   ├── auth/
│   └── shared-types/
├── package.json
└── docker-compose.yml

Chi tiết workflow:
- Main GameHub > Tạo phòng (Có mã phòng) và chỉ người tạo phòng được chỉnh setting > Chọn game (werewolves, ...) > Người chơi nhập tên và mã phòng để vào phòng. 
- Mỗi game có 1 setting khác nhau và điểm của từng game tính riêng(i.e. reset điểm mỗi khi chơi game mới), chủ phòng có thể đổi game

