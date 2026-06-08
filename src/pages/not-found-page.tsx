import { NavLink } from "react-router-dom";

import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export const NotFoundPage = () => (
  <div className="grid min-h-[60vh] place-items-center">
    <Card className="max-w-xl">
      <CardHeader>
        <div>
          <CardTitle>Route Not Found</CardTitle>
          <CardDescription>The page you requested does not exist.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <NavLink to="/members">
          <Button>Return to Members</Button>
        </NavLink>
      </CardContent>
    </Card>
  </div>
);
