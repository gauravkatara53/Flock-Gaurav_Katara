import { Router } from 'express';
import { transformerController } from '../controllers/transformer.controller';
import { hierarchyController } from '../controllers/hierarchy.controller';

const router = Router();

router.get('/', transformerController.listTransformers);
router.get('/:transformerId/meters', hierarchyController.getTransformerMeters);

export default router;
