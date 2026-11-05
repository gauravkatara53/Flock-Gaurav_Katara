import { Router } from 'express';
import { meterController } from '../controllers/meter.controller';
import { exportController } from '../controllers/export.controller';

const router = Router();

// Static export routes defined before parameterized routes (:meterId) to avoid route collisions
router.get('/export/status', exportController.getExportStatus);
router.get('/export', exportController.triggerExport);
router.get('/local', exportController.searchLocalMeters);
router.get('/local/:meterId', exportController.getLocalMeterById);

// Live portal meter routes
router.get('/', meterController.searchMeters);
router.get('/:meterId/location', meterController.getMeterLocation);
router.get('/:meterId/consumption', meterController.getMeterConsumption);

export default router;
