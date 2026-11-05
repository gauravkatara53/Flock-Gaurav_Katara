import { Router } from 'express';
import { hierarchyController } from '../controllers/hierarchy.controller';

const router = Router();

router.get('/', hierarchyController.getHierarchySummary);
router.get('/tree', hierarchyController.getHierarchyTree);
router.get('/children', hierarchyController.getHierarchyChildren);
router.get('/meters', hierarchyController.filterMetersByHierarchy);
router.get('/transformers/:transformerId/meters', hierarchyController.getTransformerMeters);

export default router;

