# JSON to CSV Converter

This script converts UNITY JSON members export into a CSV file.

It keeps only the required fields, groups members by `family_id`, and preserves the existing `import_status` and `status` values when the CSV already exists.

## Usage

Run:

```bash
python3 json_to_csv.py unity_import_<date>.json members.csv
```

Where:

* `unity_import_<date>.json` is the input JSON file.
* `members.csv` is the CSV file to create or update.

## Example

```bash
python3 json_to_csv.py unity_import_sept27_2026.json members.csv
```

## How Updates Work

When the script runs:

* New members are added with:

  * `import_status = NEW`
  * `status = empty`
* Existing members are matched using:

  * `family_id`
  * `id`
* Existing `import_status` and `status` values are preserved.
* Other member information is refreshed from the JSON.
* Existing CSV members that are not in the new JSON are kept.
* Members are sorted by `family_id` so family members appear together.

## Requirements

Python 3 is required.

No additional Python packages are needed.
