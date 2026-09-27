#!/usr/bin/env python3

import argparse
import csv
import json
import os
import re
from datetime import datetime


# Fields copied from the JSON, in the exact requested order
JSON_FIELDS = [
    "family_id",
    "household_name",
    "id",
    "first_name",
    "last_name",
    "member_name_standard",
    "phone",
    "email",
    "dob_full",
    "address_1",
    "postal_code",
    "gender",
    "family_status",
    "activated",
    "approved",
    "username",
    "registered_date",
]

# Additional CSV-only fields
CSV_FIELDS = JSON_FIELDS + [
    "import_status",
    "status",
    "outreach_group",
    "sync_time",
]


def normalize(value):
    """Convert None to empty string and everything else to string."""
    if value is None:
        return ""

    return str(value).strip()


def current_sync_time():
    """
    Return the current date and hour.

    Example:
    2026-09-27(17:10)
    """
    return datetime.now().strftime("%Y-%m-%d(%H:%M)")


def generate_output_filename(csv_file):
    """
    Generate the output CSV filename using the current date/hour.

    Example:
        members.csv
            ->
        members_2026-09-27(17).csv

    If the input already has a timestamp:
        members_2026-09-27(16).csv
            ->
        members_2026-09-27(17).csv
    """

    directory = os.path.dirname(csv_file)
    filename = os.path.basename(csv_file)

    name, extension = os.path.splitext(filename)

    if not extension:
        extension = ".csv"

    # Remove existing timestamp suffix if present
    # Example: members_2026-09-27(16:02) -> members
    name = re.sub(
        r"_\d{4}-\d{2}-\d{2}\(\d{2}:\d{2}\)$",
        "",
        name
    )

    timestamp = current_sync_time()

    output_filename = f"{name}_{timestamp}{extension}"

    return os.path.join(
        directory,
        output_filename
    )


def get_key(row):
    """
    Unique identifier for each member:
    family_id + id
    """

    return (
        normalize(row.get("family_id")),
        normalize(row.get("id")),
    )


def load_existing_csv(csv_file):
    """
    Load the existing CSV into a dictionary indexed by:
    (family_id, id)

    If the CSV does not exist, start with an empty dataset.
    """

    existing = {}

    if not os.path.exists(csv_file):
        print(f"No existing CSV found: {csv_file}")
        print("A new CSV will be created.")
        return existing

    with open(
        csv_file,
        "r",
        encoding="utf-8-sig",
        newline=""
    ) as f:

        reader = csv.DictReader(f)

        for row in reader:

            key = get_key(row)

            if key != ("", ""):
                existing[key] = row

    return existing


def load_json(json_file):
    """Load members from the JSON file."""

    with open(
        json_file,
        "r",
        encoding="utf-8"
    ) as f:

        data = json.load(f)

    members = data.get("data", [])

    if not isinstance(members, list):
        raise ValueError(
            'Expected the JSON to contain a "data" array.'
        )

    return members


def imported_data_changed(current, new_data):
    """
    Check whether any field imported from JSON changed.

    These CSV-managed fields are NOT considered:
      - import_status
      - status
      - outreach_group
      - sync_time
    """

    for field in JSON_FIELDS:

        old_value = normalize(
            current.get(field)
        )

        new_value = normalize(
            new_data.get(field)
        )

        if old_value != new_value:
            return True

    return False


def update_members(json_members, existing_members):
    """
    Add new members and update existing members.

    NEW member:
      import_status = NEW
      status = ""
      outreach_group = ""
      sync_time = current date/hour

    Existing member with changed JSON data:
      preserve import_status
      preserve status
      preserve outreach_group
      update sync_time

    Existing member with NO changes:
      preserve import_status
      preserve status
      preserve outreach_group
      preserve sync_time
    """

    result = dict(existing_members)

    new_count = 0
    changed_count = 0
    unchanged_count = 0

    # Same timestamp used for the entire sync operation
    run_sync_time = current_sync_time()

    for member in json_members:

        key = get_key(member)

        # family_id and id are required
        if not key[0] or not key[1]:

            print(
                f"WARNING: Skipping row without family_id or id: "
                f"{member.get('member_name_standard', 'Unknown')}"
            )

            continue

        # Create clean data containing only wanted JSON fields
        new_data = {
            field: normalize(member.get(field))
            for field in JSON_FIELDS
        }

        # ---------------------------------------
        # Existing member
        # ---------------------------------------
        if key in result:

            current = result[key]

            changed = imported_data_changed(
                current,
                new_data
            )

            # Preserve manually managed CSV fields
            new_data["import_status"] = normalize(
                current.get("import_status")
            )

            new_data["status"] = normalize(
                current.get("status")
            )

            new_data["outreach_group"] = normalize(
                current.get("outreach_group")
            )

            if changed:

                # Imported data changed
                new_data["sync_time"] = run_sync_time

                changed_count += 1

            else:

                # Imported data did not change
                # Keep the previous sync_time
                existing_sync_time = normalize(
                    current.get("sync_time")
                )

                if existing_sync_time:
                    new_data["sync_time"] = existing_sync_time

                else:
                    # Older CSV may not have sync_time yet
                    new_data["sync_time"] = run_sync_time

                unchanged_count += 1

        # ---------------------------------------
        # New member
        # ---------------------------------------
        else:

            new_data["import_status"] = "NEW"
            new_data["status"] = ""
            new_data["outreach_group"] = ""
            new_data["sync_time"] = run_sync_time

            new_count += 1

        result[key] = new_data

    return (
        result,
        new_count,
        changed_count,
        unchanged_count
    )


def sort_members(members):
    """
    Group members belonging to the same family together.

    Primary sort:
        family_id

    Secondary sort:
        id
    """

    def sort_key(row):

        family_id = normalize(
            row.get("family_id")
        )

        member_id = normalize(
            row.get("id")
        )

        try:
            member_id_sort = int(member_id)

        except ValueError:
            member_id_sort = member_id

        return (
            family_id,
            member_id_sort
        )

    return sorted(
        members.values(),
        key=sort_key
    )


def write_csv(csv_file, rows):
    """Write the final CSV file."""

    with open(
        csv_file,
        "w",
        encoding="utf-8-sig",
        newline=""
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=CSV_FIELDS,
            extrasaction="ignore"
        )

        writer.writeheader()

        for row in rows:

            writer.writerow({
                field: row.get(field, "")
                for field in CSV_FIELDS
            })


def main():

    parser = argparse.ArgumentParser(
        description=(
            "Import church member JSON data "
            "and synchronize it with a CSV file."
        )
    )

    parser.add_argument(
        "json_file",
        help="Input JSON file"
    )

    parser.add_argument(
        "csv_file",
        help=(
            "Existing CSV file used as the source "
            "for synchronization"
        )
    )

    args = parser.parse_args()

    # Load existing CSV
    existing_members = load_existing_csv(
        args.csv_file
    )

    # Load latest JSON export
    json_members = load_json(
        args.json_file
    )

    # Synchronize
    (
        members,
        new_count,
        changed_count,
        unchanged_count
    ) = update_members(
        json_members,
        existing_members
    )

    # Group family members together
    sorted_members = sort_members(
        members
    )

    # Generate timestamped output filename
    output_file = generate_output_filename(
        args.csv_file
    )

    # Write new CSV
    write_csv(
        output_file,
        sorted_members
    )

    print()
    print("Sync completed")
    print("----------------------------------------")
    print(f"Sync time:              {current_sync_time()}")
    print(f"JSON records processed: {len(json_members)}")
    print(f"New records:            {new_count}")
    print(f"Changed records:        {changed_count}")
    print(f"Unchanged records:      {unchanged_count}")
    print(f"Total CSV records:      {len(sorted_members)}")
    print()
    print(f"Source CSV:             {args.csv_file}")
    print(f"New CSV:                {output_file}")


if __name__ == "__main__":
    main()