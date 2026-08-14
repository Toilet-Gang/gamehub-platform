import { BaseRole } from './BaseRole.js';

export class VillagerRole extends BaseRole {
  constructor() {
    super({
      id: 'dan-thuong',
      name: 'Dân Thường',
      description: 'Không có kỹ năng ban đêm. Tìm kiếm và treo cổ Ma Sói vào ban ngày.',
      group: 1, // Villager team
      order: 99,
    });
  }
}
