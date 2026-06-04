import { NavLink } from "react-router-dom";

import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export const NotFoundPage = () => (
  <div className="grid min-h-[60vh] place-items-center">
    <Card className="max-w-xl">
      <CardHeader>
        <div>
          <CardTitle>Route Not Found</CardTitle>
          <CardDescription>This starter template only includes a dashboard and sample records page by default.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <NavLink to="/dashboard">
          <Button>Return to Dashboard</Button>
        </NavLink>
      </CardContent>
    </Card>
  </div>
);
