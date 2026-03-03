import { FoodDetailSheet } from '@/components/food/FoodDetailSheet';

export default function FoodDetailSheetModalPage({ params }: { params: { foodKey: string } }) {
  return <FoodDetailSheet foodKey={params.foodKey} />;
}
