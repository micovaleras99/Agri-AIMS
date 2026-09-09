const express = require('express');
const userController = require('../../controllers/userController');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

const router = express.Router();

router.use(authenticateJWT);

router.get('/', requireRole('admin'), userController.listUsers);
router.get('/:id', userController.getUser);
router.post('/', requireRole('admin'), userController.createUser);
router.put('/:id', userController.updateUser);
router.delete('/:id', requireRole('admin'), userController.deleteUser);

module.exports = router;
