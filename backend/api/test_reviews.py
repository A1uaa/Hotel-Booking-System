from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from hotel.models import Review, Room

from .tests import inventory

User = get_user_model()


class ReviewTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.room = inventory()
        cls.guest = User.objects.create_user("guest", email="guest@example.com")
        cls.other = User.objects.create_user("other", email="other@example.com")

    def setUp(self):
        cache.clear()  # posting feedback is rate limited per user or IP address

    def url(self, room=None):
        return f"/api/rooms/{(room or self.room).pk}/reviews/"

    def make_review(self, rating=5, comment="Lovely", hidden=False, room=None, user=None, name="Guest"):
        return Review.objects.create(
            room=room or self.room, user=user, author_name=name, rating=rating, comment=comment, is_hidden=hidden,
        )


class LeaveFeedbackTests(ReviewTestCase):
    def test_a_visitor_without_an_account_can_leave_feedback(self):
        response = APIClient().post(self.url(), {"rating": 4, "comment": "  Quiet and clean.  ", "name": " Aida "}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        review = Review.objects.get()
        self.assertEqual((review.room, review.user, review.author_name), (self.room, None, "Aida"))
        self.assertEqual((review.rating, review.comment, review.is_hidden), (4, "Quiet and clean.", False))
        self.assertEqual(response.data["review"]["author"], "Aida")
        self.assertEqual((response.data["count"], response.data["average"]), (1, 4.0))

    def test_no_booking_is_needed_and_comment_and_name_are_optional(self):
        response = APIClient().post(self.url(), {"rating": 5}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        review = Review.objects.get()
        self.assertEqual((review.comment, review.author_name), ("", "Guest"))

    def test_a_signed_in_guest_is_linked_and_uses_their_first_name(self):
        self.guest.first_name = "Dana"
        self.guest.save()
        client = APIClient()
        client.force_login(self.guest)
        self.assertEqual(client.post(self.url(), {"rating": 3}, format="json").status_code, 201)
        review = Review.objects.get()
        self.assertEqual((review.user, review.author_name), (self.guest, "Dana"))

    def test_a_signed_in_guest_reviews_a_room_only_once(self):
        client = APIClient()
        client.force_login(self.guest)
        self.assertEqual(client.post(self.url(), {"rating": 5}, format="json").status_code, 201)
        again = client.post(self.url(), {"rating": 1}, format="json")
        self.assertEqual(again.status_code, 409)
        self.assertEqual(Review.objects.get().rating, 5)

    def test_a_guest_can_review_different_rooms_and_visitors_can_repeat(self):
        other_room = Room.objects.create(
            room_type=self.room.room_type, room_number="102", description="Other", price_per_night=30000, capacity=2,
        )
        client = APIClient()
        client.force_login(self.guest)
        self.assertEqual(client.post(self.url(), {"rating": 5}, format="json").status_code, 201)
        self.assertEqual(client.post(self.url(other_room), {"rating": 4}, format="json").status_code, 201)
        visitor = APIClient()
        self.assertEqual(visitor.post(self.url(), {"rating": 3}, format="json").status_code, 201)
        self.assertEqual(visitor.post(self.url(), {"rating": 2}, format="json").status_code, 201)
        self.assertEqual(Review.objects.count(), 4)

    def test_rejects_invalid_input(self):
        bodies = ({}, {"rating": 0}, {"rating": 6}, {"rating": "five"}, {"rating": 3, "comment": "x" * 2001},
                  {"rating": 3, "name": "n" * 81})
        for body in bodies:
            self.assertEqual(APIClient().post(self.url(), body, format="json").status_code, 400, body)
        self.assertEqual(Review.objects.count(), 0)

    def test_unknown_room_returns_404(self):
        self.assertEqual(APIClient().post("/api/rooms/99999/reviews/", {"rating": 5}, format="json").status_code, 404)

    def test_posting_is_rate_limited_but_reading_is_not(self):
        client = APIClient()
        for _ in range(10):
            self.assertEqual(client.post(self.url(), {"rating": 5}, format="json").status_code, 201)
        self.assertEqual(client.post(self.url(), {"rating": 5}, format="json").status_code, 429)
        self.assertEqual(client.get(self.url()).status_code, 200)

    def test_database_rejects_a_rating_outside_one_to_five(self):
        for rating in (0, 6):
            with self.assertRaises(IntegrityError), transaction.atomic():
                Review.objects.create(room=self.room, rating=rating)

    def test_database_allows_one_review_per_user_and_room(self):
        self.make_review(user=self.guest)
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make_review(user=self.guest)
        self.make_review()  # visitors have no user, so they are not limited by the constraint
        self.make_review()


class RoomReviewListTests(ReviewTestCase):
    def test_room_without_reviews(self):
        response = APIClient().get(self.url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {
            "room": self.room.pk, "count": 0, "average": None,
            "breakdown": {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}, "reviews": [],
        })

    def test_average_count_breakdown_and_newest_first(self):
        self.make_review(rating=5, comment="First")
        self.make_review(rating=4, comment="Second")
        self.make_review(rating=4, comment="Third")
        data = APIClient().get(self.url()).data
        self.assertEqual((data["count"], data["average"]), (3, 4.3))
        self.assertEqual(data["breakdown"], {"1": 0, "2": 0, "3": 0, "4": 2, "5": 1})
        self.assertEqual([item["comment"] for item in data["reviews"]], ["Third", "Second", "First"])

    def test_hidden_reviews_are_not_shown_or_counted(self):
        self.make_review(rating=5)
        self.make_review(rating=1, comment="Hidden", hidden=True)
        data = APIClient().get(self.url()).data
        self.assertEqual((data["count"], data["average"]), (1, 5.0))
        self.assertEqual(data["breakdown"]["1"], 0)
        self.assertNotIn("Hidden", str(data))

    def test_only_this_rooms_reviews(self):
        other_room = Room.objects.create(
            room_type=self.room.room_type, room_number="102", description="Other", price_per_night=30000, capacity=2,
        )
        self.make_review(room=other_room)
        self.assertEqual(APIClient().get(self.url()).data["count"], 0)

    def test_no_personal_details_are_exposed(self):
        self.make_review(user=self.guest, name="Dana")
        item = APIClient().get(self.url()).data["reviews"][0]
        self.assertEqual(set(item), {"id", "rating", "comment", "author", "created_at"})
        self.assertEqual(item["author"], "Dana")
        self.assertNotIn("guest@example.com", str(item))

    def test_unknown_room_returns_404(self):
        self.assertEqual(APIClient().get("/api/rooms/99999/reviews/").status_code, 404)


class RoomRatingOnCatalogTests(ReviewTestCase):
    """The rooms list and the room page carry the rating so cards can show it."""

    def test_rooms_without_reviews(self):
        item = APIClient().get("/api/rooms/").data[0]
        self.assertEqual((item["rating_average"], item["rating_count"]), (None, 0))

    def test_rooms_show_average_and_count_of_visible_reviews_only(self):
        other_room = Room.objects.create(
            room_type=self.room.room_type, room_number="102", description="Other", price_per_night=30000, capacity=2,
        )
        self.make_review(rating=5)
        self.make_review(rating=4)
        self.make_review(rating=1, hidden=True)
        self.make_review(rating=2, room=other_room)
        rows = {row["id"]: row for row in APIClient().get("/api/rooms/").data}
        self.assertEqual((rows[self.room.pk]["rating_average"], rows[self.room.pk]["rating_count"]), (4.5, 2))
        self.assertEqual((rows[other_room.pk]["rating_average"], rows[other_room.pk]["rating_count"]), (2.0, 1))
        detail = APIClient().get(f"/api/rooms/{self.room.pk}/").data
        self.assertEqual((detail["rating_average"], detail["rating_count"]), (4.5, 2))

    def test_a_new_review_shows_up_on_the_catalog(self):
        APIClient().post(self.url(), {"rating": 3}, format="json")
        item = APIClient().get("/api/rooms/").data[0]
        self.assertEqual((item["rating_average"], item["rating_count"]), (3.0, 1))


class StaffReviewTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.review = self.make_review(rating=2, comment="Noisy corridor", user=self.guest, name="Dana")
        self.moderator = User.objects.create_user("moderator", email="mod@example.com", is_staff=True)
        self.moderator.user_permissions.add(*Permission.objects.filter(codename__in=("view_review", "change_review")))
        self.reader = User.objects.create_user("reader", email="reader@example.com", is_staff=True)
        self.reader.user_permissions.add(Permission.objects.get(codename="view_review"))

    def test_moderator_lists_reviews_with_author_and_room(self):
        self.make_review(rating=4, comment="From a visitor")
        self.client.force_login(self.moderator)
        response = self.client.get("/api/admin/reviews/")
        self.assertEqual(response.status_code, 200)
        rows = {row["comment"]: row for row in response.data}
        noisy = rows["Noisy corridor"]
        self.assertEqual(noisy["guest"]["email"], "guest@example.com")
        self.assertEqual((noisy["room_number"], noisy["author_name"], noisy["rating"], noisy["is_hidden"]), ("101", "Dana", 2, False))
        self.assertIsNone(rows["From a visitor"]["guest"])

    def test_filters(self):
        self.make_review(rating=5, comment="Superb", hidden=True, user=self.other, name="Omar")
        self.client.force_login(self.moderator)
        get = lambda **params: [row["comment"] for row in self.client.get("/api/admin/reviews/", params).data]
        self.assertEqual(sorted(get()), ["Noisy corridor", "Superb"])
        self.assertEqual(get(visibility="hidden"), ["Superb"])
        self.assertEqual(get(visibility="visible"), ["Noisy corridor"])
        self.assertEqual(get(rating=2), ["Noisy corridor"])
        self.assertEqual(get(q="other@example.com"), ["Superb"])
        self.assertEqual(get(q="Dana"), ["Noisy corridor"])
        self.assertEqual(self.client.get("/api/admin/reviews/", {"rating": 9}).status_code, 400)
        self.assertEqual(self.client.get("/api/admin/reviews/", {"visibility": "x"}).status_code, 400)

    def test_hiding_removes_the_review_from_the_room_page_and_it_can_be_restored(self):
        self.client.force_login(self.moderator)
        url = f"/api/admin/reviews/{self.review.pk}/visibility/"
        response = self.client.post(url, {"hidden": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["is_hidden"])
        public = APIClient().get(self.url()).data
        self.assertEqual((public["count"], public["reviews"]), (0, []))
        self.assertEqual(APIClient().get("/api/rooms/").data[0]["rating_count"], 0)
        self.assertTrue(Review.objects.get().is_hidden)
        self.client.post(url, {"hidden": False}, format="json")
        self.assertEqual(APIClient().get(self.url()).data["count"], 1)

    def test_visibility_needs_a_boolean_and_an_existing_review(self):
        self.client.force_login(self.moderator)
        self.assertEqual(self.client.post(f"/api/admin/reviews/{self.review.pk}/visibility/", {}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/admin/reviews/99999/visibility/", {"hidden": True}, format="json").status_code, 404)

    def test_view_only_staff_cannot_change_visibility(self):
        self.client.force_login(self.reader)
        self.assertEqual(self.client.get("/api/admin/reviews/").status_code, 200)
        response = self.client.post(f"/api/admin/reviews/{self.review.pk}/visibility/", {"hidden": True}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Review.objects.get().is_hidden)

    def test_guests_and_staff_without_permission_are_denied(self):
        self.assertEqual(APIClient().get("/api/admin/reviews/").status_code, 403)
        self.client.force_login(self.guest)
        self.assertEqual(self.client.get("/api/admin/reviews/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/admin/reviews/{self.review.pk}/visibility/", {"hidden": True}, format="json").status_code, 403)
        nobody = User.objects.create_user("nobody", email="n@example.com", is_staff=True)
        self.client.force_login(nobody)
        self.assertEqual(self.client.get("/api/admin/reviews/").status_code, 403)

    def test_capabilities_reflect_review_permissions(self):
        self.client.force_login(self.reader)
        caps = self.client.get("/api/admin/me/").data["capabilities"]
        self.assertTrue(caps["reviews"])
        self.assertFalse(caps["moderateReviews"])
        self.client.force_login(self.moderator)
        self.assertTrue(self.client.get("/api/admin/me/").data["capabilities"]["moderateReviews"])
