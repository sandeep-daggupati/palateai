import { FoodDetailContent } from '@/components/food/FoodDetailContent';

export default function FoodDetailPage({ params }: { params: { foodKey: string } }) {
  return <FoodDetailContent foodKey={params.foodKey} showBackLink />;
}
