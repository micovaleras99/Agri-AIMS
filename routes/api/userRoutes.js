const express = require('express');
const userController = require('../../controllers/userController');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

const router = express.Router();

router.use(authenticateJWT);

router.get('/', requireRole('admin'), userController.listUsers);
router.get('/:id', userController.getUser);
router.post('/', requireRole('admin'), userController.createUser);
router.put('/:id', userController.updateUser);
router.get('/:id/audit', requireRole('admin'), userController.getUserAudit);
// Account lifecycle (admin only). Deactivate is the non-destructive default;
// permanent DELETE requires ?confirm=permanent in the controller.
router.post('/:id/deactivate', requireRole('admin'), userController.deactivateUser);
router.post('/:id/reactivate', requireRole('admin'), userController.reactivateUser);
router.post('/:id/relink', requireRole('admin'), userController.relinkUser);
router.delete('/:id', requireRole('admin'), userController.deleteUser);

module.exports = router;
