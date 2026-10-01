/** Demo customers — the personas from FYP-1 §2.4. */
export interface Customer {
  id: string;
  name: string;
  firstName: string;
  description: string;
}

export const CUSTOMERS: Customer[] = [
  {
    id: "hassan",
    name: "Hassan Raza",
    firstName: "Hassan",
    description: "IT manager in Lahore, saves PKR 25,000 a month",
  },
  {
    id: "bushra",
    name: "Bushra Khan",
    firstName: "Bushra",
    description: "Freelance designer in Karachi, paid in dollars",
  },
  {
    id: "aliya",
    name: "Aliya Siddiqui",
    firstName: "Aliya",
    description: "Student at LUMS, saves PKR 1,000 at a time",
  },
];

export function findCustomer(id: string | undefined): Customer | undefined {
  return CUSTOMERS.find((c) => c.id === id);
}
