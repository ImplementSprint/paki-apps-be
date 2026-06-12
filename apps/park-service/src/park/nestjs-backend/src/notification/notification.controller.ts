import { Controller, Get, Patch, Delete, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

/**
 * NotificationController — interacts with notifications.notifications (UUID user_id).
 * No public schema references.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private sequelize: Sequelize) {}

  @Get()
  async getMyNotifications(@Req() req: any, @Query('page') page = '1', @Query('limit') limit = '20') {
    try {
      const p = Math.max(1, parseInt(page));
      const l = Math.min(50, parseInt(limit));
      const offset = (p - 1) * l;

      const [notifications, [totalRow], [unreadRow]]: [any[], any[], any[]] = await Promise.all([
        this.sequelize.query(
          `SELECT id, user_id AS "userId", type, title, message AS body, is_read AS "isRead", source_service AS "sourceService", created_at AS "createdAt"
           FROM notifications.notifications
           WHERE user_id = :userId
           ORDER BY created_at DESC
           LIMIT :limit OFFSET :offset`,
          { replacements: { userId: req.user.authId, limit: l, offset }, type: QueryTypes.SELECT },
        ),
        this.sequelize.query(
          `SELECT COUNT(*)::int AS count FROM notifications.notifications WHERE user_id = :userId`,
          { replacements: { userId: req.user.authId }, type: QueryTypes.SELECT },
        ),
        this.sequelize.query(
          `SELECT COUNT(*)::int AS count FROM notifications.notifications WHERE user_id = :userId AND is_read = false`,
          { replacements: { userId: req.user.authId }, type: QueryTypes.SELECT },
        ),
      ]);

      const total = totalRow?.count || 0;
      const unreadCount = unreadRow?.count || 0;

      return {
        success: true,
        data: {
          notifications: notifications.map((n) => ({ ...n, _id: String(n.id) })),
          total,
          page: p,
          totalPages: Math.ceil(total / l),
          unreadCount,
        },
      };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Get('unread-count')
  async getUnreadCount(@Req() req: any) {
    try {
      const [row]: any[] = await this.sequelize.query(
        `SELECT COUNT(*)::int AS count FROM notifications.notifications WHERE user_id = :userId AND is_read = false`,
        { replacements: { userId: req.user.authId }, type: QueryTypes.SELECT },
      );
      return { success: true, data: { count: row?.count || 0 } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch('read-all')
  async markAllRead(@Req() req: any) {
    try {
      await this.sequelize.query(
        `UPDATE notifications.notifications SET is_read = true WHERE user_id = :userId AND is_read = false`,
        { replacements: { userId: req.user.authId } },
      );
      return { success: true, message: 'All notifications marked as read' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Patch(':id/read')
  async markOneRead(@Req() req: any, @Param('id') id: string) {
    try {
      const [updatedRows] = await this.sequelize.query(
        `UPDATE notifications.notifications SET is_read = true
         WHERE id = :id AND user_id = :userId
         RETURNING id, user_id AS "userId", type, title, message AS body, is_read AS "isRead", source_service AS "sourceService", created_at AS "createdAt"`,
        { replacements: { id: parseInt(id), userId: req.user.authId } },
      );
      const updated = (updatedRows as any[])[0] || null;
      if (!updated) return { success: false, message: 'Notification not found' };
      return { success: true, data: { ...updated, _id: String(updated.id) } };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Delete()
  async clearAll(@Req() req: any) {
    try {
      await this.sequelize.query(
        `DELETE FROM notifications.notifications WHERE user_id = :userId`,
        { replacements: { userId: req.user.authId } },
      );
      return { success: true, message: 'All notifications cleared' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  @Delete(':id')
  async deleteOne(@Req() req: any, @Param('id') id: string) {
    try {
      const [result]: [any, any] = await this.sequelize.query(
        `DELETE FROM notifications.notifications WHERE id = :id AND user_id = :userId`,
        { replacements: { id: parseInt(id), userId: req.user.authId } },
      );
      return { success: true, message: 'Notification deleted' };
    } catch (e) { return { success: false, message: e.message }; }
  }
}
