import { redirect } from 'next/navigation';

export default function DishDetailRedirectPage({ params }: { params: { dishKey: string } }) {
  redirect(`/food/${params.dishKey}`);
}
